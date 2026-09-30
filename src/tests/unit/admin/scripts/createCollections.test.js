'use strict';

/**
 * Tests for src/admin/scripts/createCollections.js -- the CLI wrapper (run via
 * `node src/admin/scripts/createCollections`) that wires a CreateCollectionsRunner into the
 * real IoC container and runs it once.
 *
 * Unlike its sibling admin scripts, this script takes NO CLI arguments at all -- there is no
 * `--collections` flag, no
 * comma-separated-list parsing, and therefore none of the "omitted CLI arg silently defaults to
 * an empty/no-op collections list" defect class those scripts exhibit.
 *
 * CreateCollectionsRunner itself is mocked here (it has its own dedicated, thorough test at
 * src/tests/unit/admin/runners/createCollectionsRunner.test.js) so these tests focus purely on
 * createCollections.js's OWN logic: what it wires into the runner's constructor, that it awaits
 * processAsync() before exiting, and its top-level error handling. `createContainer()` is
 * replaced with a REAL SimpleContainer (the actual IoC container class, not a stub) pre-populated
 * with sentinel indexManager/mongoDatabaseManager values, so the script's own
 * `container.register('createCollectionsRunner', ...)` call and the resulting lazy-getter/
 * memoization behavior are exercised for real -- only the heavy, I/O-touching dependencies
 * (CreateCollectionsRunner's real Mongo calls, AdminLogger's real Winston logger) are mocked.
 */

const { describe, test, expect, beforeEach, afterEach, jest: jestGlobal } = require('@jest/globals');
const { SimpleContainer } = require('../../../../utils/simpleContainer');

/** Flushes the microtask queue so createCollections.js's unawaited `main().catch(...)` settles. */
async function flush () {
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
}

describe('createCollections.js (admin CLI script)', () => {
    let exitSpy;
    let consoleErrorSpy;

    beforeEach(() => {
        exitSpy = jestGlobal.spyOn(process, 'exit').mockImplementation(() => {});
        consoleErrorSpy = jestGlobal.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
        jestGlobal.restoreAllMocks();
    });

    /**
     * Loads src/admin/scripts/createCollections.js fresh, with a REAL SimpleContainer as the
     * createContainer() return value (pre-registered with sentinel indexManager/
     * mongoDatabaseManager), a mocked AdminLogger class, and a mocked CreateCollectionsRunner
     * class whose constructor is fully observable via `RunnerCtor.instances`.
     * @param {{ processAsyncImpl?: Function, constructRunnerImpl?: Function }} opts
     */
    function loadScript ({ processAsyncImpl, constructRunnerImpl } = {}) {
        const indexManagerSentinel = { marker: 'INDEX_MANAGER_SENTINEL' };
        const mongoDatabaseManagerSentinel = { marker: 'MONGO_DB_MANAGER_SENTINEL' };

        const realContainer = new SimpleContainer();
        realContainer.register('indexManager', () => indexManagerSentinel);
        realContainer.register('mongoDatabaseManager', () => mongoDatabaseManagerSentinel);

        const createContainerMock = jestGlobal.fn(() => realContainer);

        const adminLoggerInstances = [];
        function AdminLoggerMock () {
            this.marker = 'ADMIN_LOGGER_INSTANCE';
            adminLoggerInstances.push(this);
        }

        const runnerInstances = [];
        function CreateCollectionsRunnerMock (params) {
            if (constructRunnerImpl) {
                constructRunnerImpl(params);
            }
            this.constructorParams = params;
            this.processAsync = jestGlobal.fn(processAsyncImpl || (() => Promise.resolve()));
            runnerInstances.push(this);
        }

        jestGlobal.doMock('../../../../createContainer', () => ({ createContainer: createContainerMock }));
        jestGlobal.doMock('../../../../admin/adminLogger', () => ({ AdminLogger: AdminLoggerMock }));
        jestGlobal.doMock('../../../../admin/runners/createCollectionsRunner', () => ({
            CreateCollectionsRunner: CreateCollectionsRunnerMock
        }));

        jestGlobal.isolateModules(() => {
            require('../../../../admin/scripts/createCollections');
        });

        return {
            realContainer,
            indexManagerSentinel,
            mongoDatabaseManagerSentinel,
            adminLoggerInstances,
            runnerInstances,
            createContainerMock
        };
    }

    test('wires indexManager and mongoDatabaseManager straight from the container into the runner', async () => {
        const { runnerInstances, indexManagerSentinel, mongoDatabaseManagerSentinel } = loadScript();
        await flush();

        expect(runnerInstances).toHaveLength(1);
        expect(runnerInstances[0].constructorParams.indexManager).toBe(indexManagerSentinel);
        expect(runnerInstances[0].constructorParams.mongoDatabaseManager).toBe(mongoDatabaseManagerSentinel);
    });

    test('wires a FRESH AdminLogger instance into the runner (not a container-shared one)', async () => {
        const { runnerInstances, adminLoggerInstances } = loadScript();
        await flush();

        expect(adminLoggerInstances).toHaveLength(1);
        expect(runnerInstances[0].constructorParams.adminLogger).toBe(adminLoggerInstances[0]);
        expect(runnerInstances[0].constructorParams.adminLogger.marker).toBe('ADMIN_LOGGER_INSTANCE');
    });

    test('registers the runner under the container name "createCollectionsRunner", memoized (constructed exactly once even on repeat access)', async () => {
        const { realContainer, runnerInstances } = loadScript();
        await flush();

        expect(runnerInstances).toHaveLength(1);
        // SimpleContainer's getter memoizes on first access (see utils/simpleContainer.js) --
        // accessing the same registered name again must return the SAME instance, not construct
        // a second one.
        expect(realContainer.createCollectionsRunner).toBe(runnerInstances[0]);
        expect(runnerInstances).toHaveLength(1);
    });

    test('calls processAsync() on the constructed runner exactly once', async () => {
        const { runnerInstances } = loadScript();
        await flush();

        expect(runnerInstances[0].processAsync).toHaveBeenCalledTimes(1);
    });

    test('genuinely AWAITS processAsync() before exiting -- exit(0) does not fire until the runner\'s promise resolves', async () => {
        let resolveProcessAsync;
        const pending = new Promise((resolve) => { resolveProcessAsync = resolve; });
        loadScript({ processAsyncImpl: () => pending });

        await flush();
        // processAsync() has not resolved yet -- if the script called process.exit(0) without
        // awaiting (fire-and-forget), it would already have fired here.
        expect(exitSpy).not.toHaveBeenCalled();

        resolveProcessAsync();
        await flush();
        expect(exitSpy).toHaveBeenCalledWith(0);
    });

    test('calls process.exit(0) after a successful run', async () => {
        loadScript();
        await flush();
        expect(exitSpy).toHaveBeenCalledWith(0);
    });

    test('a construction failure (e.g. a misconfigured dependency) is logged via console.error, not left completely silent', async () => {
        const boom = new Error('indexManager misconfigured');
        loadScript({ constructRunnerImpl: () => { throw boom; } });
        await flush();

        expect(consoleErrorSpy).toHaveBeenCalledWith(boom);
    });
});
