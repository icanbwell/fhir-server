'use strict';

/**
 * Tests for src/index.js -- the process entry point: env-driven cluster fork/signal-forwarding
 * logic in the primary process, and the worker-path bootstrap (initSentry -> initialize ->
 * createContainer -> fhirSchemaValidator.preWarm -> createServer -> cronTasksProcessor) with its
 * top-level error handling (process.exit(1) on failure).
 *
 * index.js has no exports (module.exports is never set) -- it is a pure script executed via
 * `node src/index.js`. Every dependency it pulls in (cluster, ./server, ./createContainer,
 * ./winstonInit, ./utils/fhirSchemaValidator, ./utils/initSentry) is a genuine external
 * infrastructure boundary (OS process forking, HTTP listener, Mongo-backed container, Winston
 * logger) and is mocked so requiring the file exercises index.js's OWN branching/ordering logic
 * without starting a real server, a real Mongo container, or forking real OS processes.
 * `jest.isolateModules` + `jest.doMock` give each test a fresh module registry, since index.js
 * runs its top-level code (including an unawaited async IIFE in the worker path) as a side effect
 * of `require`.
 *
 * Domain invariants exercised here:
 *  - The worker path awaits each bootstrap step in order (initialize -> createContainer ->
 *    preWarm -> createServer -> cronTasksProcessor.initiateTasks) before the process is
 *    considered "up" -- an out-of-order or fire-and-forget step would let the server accept
 *    traffic before the container/cache is ready.
 *  - Any rejection during that chain must surface as a non-zero exit (process.exit(1)), so an
 *    orchestrator (k8s, systemd) restarts the pod instead of leaving it running half-initialized.
 *  - The primary process (cluster.isPrimary && numCPUs > 1) never runs the bootstrap itself; it
 *    only forks workers and forwards termination signals to them.
 *  - Signal forwarding must forward the ACTUAL signal received (SIGTERM/SIGINT/SIGQUIT), not a
 *    hardcoded one, and must suppress the auto-respawn-on-exit behavior once a shutdown signal
 *    was forwarded (otherwise a graceful shutdown would fight its own respawn logic forever).
 */

const { describe, test, expect, beforeEach, afterEach, jest: jestGlobal } = require('@jest/globals');

/** Flushes the microtask/macrotask queue so the unawaited worker-path IIFE inside index.js settles. */
async function flush () {
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
}

describe('index.js (process entry point)', () => {
    let exitSpy;
    let consoleErrorSpy;
    let consoleLogSpy;
    let originalWorkerCount;

    beforeEach(() => {
        originalWorkerCount = process.env.WORKER_COUNT;
        exitSpy = jestGlobal.spyOn(process, 'exit').mockImplementation(() => {});
        consoleErrorSpy = jestGlobal.spyOn(console, 'error').mockImplementation(() => {});
        consoleLogSpy = jestGlobal.spyOn(console, 'log').mockImplementation(() => {});
    });

    afterEach(() => {
        delete process.env.CLUSTER_SCHEDULING;
        if (originalWorkerCount === undefined) {
            delete process.env.WORKER_COUNT;
        } else {
            process.env.WORKER_COUNT = originalWorkerCount;
        }
        jestGlobal.restoreAllMocks();
    });

    /**
     * Loads src/index.js fresh with all its dependencies mocked.
     * @param {{isPrimary?: boolean, workerCount?: number, createServerImpl?: Function, cronImpl?: Function}} opts
     */
    function loadIndex ({ isPrimary = false, workerCount, createServerImpl, cronImpl, clusterScheduling } = {}) {
        if (workerCount === undefined) {
            delete process.env.WORKER_COUNT;
        } else {
            process.env.WORKER_COUNT = String(workerCount);
        }
        if (clusterScheduling === undefined) {
            delete process.env.CLUSTER_SCHEDULING;
        } else {
            process.env.CLUSTER_SCHEDULING = clusterScheduling;
        }

        const order = [];
        const forkedWorkers = [];
        const clusterMock = {
            isPrimary,
            fork: jestGlobal.fn(() => {
                const worker = { process: { kill: jestGlobal.fn() } };
                forkedWorkers.push(worker);
                return worker;
            }),
            on: jestGlobal.fn(),
            workers: {}
        };
        // The OS listening socket is an infrastructure boundary, like cluster's forking
        const netServer = {
            listen: jestGlobal.fn((port, callback) => {
                order.push('listen');
                callback();
            }),
            close: jestGlobal.fn((callback) => callback()),
            once: jestGlobal.fn(),
            on: jestGlobal.fn(),
            removeListener: jestGlobal.fn(),
            address: jestGlobal.fn(() => ({ port: 3000 }))
        };
        const netMock = { createServer: jestGlobal.fn(() => netServer) };
        clusterMock.fork.mockImplementation(() => {
            order.push('fork');
            const worker = { process: { kill: jestGlobal.fn() } };
            forkedWorkers.push(worker);
            return worker;
        });

        const initSentryMock = jestGlobal.fn();
        const initializeMock = jestGlobal.fn(() => order.push('initialize'));
        const cronTasksProcessor = {
            initiateTasks: jestGlobal.fn(cronImpl || (() => { order.push('cron'); return Promise.resolve(); }))
        };
        const kafkaClientV2 = {
            warmUpAsync: jestGlobal.fn(() => { order.push('warmUp'); return Promise.resolve(); })
        };
        const container = { cronTasksProcessor, kafkaClientV2 };
        const createContainerMock = jestGlobal.fn(() => { order.push('createContainer'); return container; });
        const preWarmMock = jestGlobal.fn(() => order.push('preWarm'));
        const createServerMock = jestGlobal.fn(
            createServerImpl || (() => { order.push('createServer'); return Promise.resolve(); })
        );
        const getCircularReplacerMock = jestGlobal.fn(() => undefined);

        jestGlobal.doMock('cluster', () => clusterMock);
        jestGlobal.doMock('net', () => netMock);
        jestGlobal.doMock('../../utils/initSentry', () => ({ initSentry: initSentryMock }));
        jestGlobal.doMock('../../server', () => ({ createServer: createServerMock }));
        jestGlobal.doMock('../../createContainer', () => ({ createContainer: createContainerMock }));
        jestGlobal.doMock('../../utils/getCircularReplacer', () => ({ getCircularReplacer: getCircularReplacerMock }));
        jestGlobal.doMock('../../winstonInit', () => ({
            initialize: initializeMock,
            getLogger: () => ({ info: jestGlobal.fn(), error: jestGlobal.fn(), warn: jestGlobal.fn(), debug: jestGlobal.fn() })
        }));
        jestGlobal.doMock('../../utils/fhirSchemaValidator', () => ({ fhirSchemaValidator: { preWarm: preWarmMock } }));

        jestGlobal.isolateModules(() => {
            require('../../index');
        });

        return {
            clusterMock,
            netMock,
            netServer,
            forkedWorkers,
            initSentryMock,
            createServerMock,
            createContainerMock,
            container,
            cronTasksProcessor,
            kafkaClientV2,
            initializeMock,
            preWarmMock,
            order
        };
    }

    test('calls initSentry({ validateOpenTelemetry: true }) unconditionally, before the cluster/worker branch runs', async () => {
        const { initSentryMock } = loadIndex();
        await flush();
        expect(initSentryMock).toHaveBeenCalledTimes(1);
        expect(initSentryMock).toHaveBeenCalledWith({ validateOpenTelemetry: true });
    });

    test('worker path: runs initialize -> createContainer -> preWarm -> createServer -> kafkaClientV2.warmUpAsync -> cronTasksProcessor.initiateTasks, in that exact order', async () => {
        const { initializeMock, createContainerMock, preWarmMock, createServerMock, cronTasksProcessor, kafkaClientV2, order } =
            loadIndex();

        await flush();

        expect(initializeMock).toHaveBeenCalledTimes(1);
        expect(createContainerMock).toHaveBeenCalledTimes(1);
        expect(preWarmMock).toHaveBeenCalledTimes(1);
        expect(createServerMock).toHaveBeenCalledTimes(1);
        expect(kafkaClientV2.warmUpAsync).toHaveBeenCalledTimes(1);
        expect(cronTasksProcessor.initiateTasks).toHaveBeenCalledTimes(1);
        expect(order).toEqual(['initialize', 'createContainer', 'preWarm', 'createServer', 'warmUp', 'cron']);
    });

    test('worker path: createServer is invoked with a callback that resolves to the SAME container instance createContainer() produced', async () => {
        const { createServerMock, container } = loadIndex();
        await flush();
        expect(createServerMock).toHaveBeenCalledTimes(1);
        const fnGetContainer = createServerMock.mock.calls[0][0];
        expect(typeof fnGetContainer).toBe('function');
        expect(fnGetContainer()).toBe(container);
    });

    test('worker path: a rejection anywhere in main() (e.g. createServer fails) is logged and exits the process with code 1', async () => {
        const boom = new Error('createServer boom');
        const { cronTasksProcessor } = loadIndex({ createServerImpl: () => Promise.reject(boom) });

        await flush();

        expect(exitSpy).toHaveBeenCalledWith(1);
        expect(consoleErrorSpy).toHaveBeenCalledWith('Error in main function:', boom);
        // The rejection must short-circuit main() -- cron task processing never starts for a
        // server that failed to come up.
        expect(cronTasksProcessor.initiateTasks).not.toHaveBeenCalled();
    });

    test('worker path: a successful run never calls process.exit', async () => {
        loadIndex();
        await flush();
        expect(exitSpy).not.toHaveBeenCalled();
    });

    test('primary path: cluster.isPrimary + WORKER_COUNT>1 forks that many workers and never runs the worker bootstrap itself', async () => {
        const { clusterMock, forkedWorkers, initializeMock, createServerMock } = loadIndex({
            isPrimary: true,
            workerCount: 3
        });
        await flush();

        expect(clusterMock.fork).toHaveBeenCalledTimes(3);
        expect(forkedWorkers.length).toBe(3);
        expect(initializeMock).not.toHaveBeenCalled();
        expect(createServerMock).not.toHaveBeenCalled();
    });

    test('primary path: SIGTERM is forwarded to EVERY live worker\'s underlying process', async () => {
        const processOnSpy = jestGlobal.spyOn(process, 'on').mockImplementation(() => process);
        const { clusterMock } = loadIndex({ isPrimary: true, workerCount: 2 });
        await flush();

        const worker1Kill = jestGlobal.fn();
        const worker2Kill = jestGlobal.fn();
        clusterMock.workers = {
            1: { process: { kill: worker1Kill } },
            2: { process: { kill: worker2Kill } }
        };

        const sigtermCall = processOnSpy.mock.calls.find(([event]) => event === 'SIGTERM');
        expect(sigtermCall).toBeDefined();
        sigtermCall[1]();

        expect(worker1Kill).toHaveBeenCalledWith('SIGTERM');
        expect(worker2Kill).toHaveBeenCalledWith('SIGTERM');
    });

    test('primary path: SIGINT and SIGQUIT each forward their OWN signal name to workers, not a hardcoded SIGTERM', async () => {
        const processOnSpy = jestGlobal.spyOn(process, 'on').mockImplementation(() => process);
        const { clusterMock } = loadIndex({ isPrimary: true, workerCount: 2 });
        await flush();

        const workerKill = jestGlobal.fn();
        clusterMock.workers = { 1: { process: { kill: workerKill } } };

        const sigintHandler = processOnSpy.mock.calls.find(([event]) => event === 'SIGINT')[1];
        sigintHandler();
        expect(workerKill).toHaveBeenLastCalledWith('SIGINT');

        const sigquitHandler = processOnSpy.mock.calls.find(([event]) => event === 'SIGQUIT')[1];
        sigquitHandler();
        expect(workerKill).toHaveBeenLastCalledWith('SIGQUIT');
    });

    test('primary path: cluster "exit" handler forks a replacement worker after an unexpected death', async () => {
        const { clusterMock } = loadIndex({ isPrimary: true, workerCount: 2 });
        await flush();

        const forkCountBefore = clusterMock.fork.mock.calls.length;
        const exitHandler = clusterMock.on.mock.calls.find(([event]) => event === 'exit')[1];
        exitHandler({ process: { pid: 4242 } }, 1, null);

        expect(clusterMock.fork).toHaveBeenCalledTimes(forkCountBefore + 1);
    });

    test('primary path: cluster "exit" handler does NOT respawn once a shutdown signal has already been forwarded', async () => {
        const processOnSpy = jestGlobal.spyOn(process, 'on').mockImplementation(() => process);
        const { clusterMock } = loadIndex({ isPrimary: true, workerCount: 2 });
        await flush();
        clusterMock.workers = { 1: { process: { kill: jestGlobal.fn() } } };

        const sigtermHandler = processOnSpy.mock.calls.find(([event]) => event === 'SIGTERM')[1];
        sigtermHandler(); // sets the module-internal `shuttingDown` flag to true

        const forkCountBefore = clusterMock.fork.mock.calls.length;
        const exitHandler = clusterMock.on.mock.calls.find(([event]) => event === 'exit')[1];
        exitHandler({ process: { pid: 4242 } }, 0, 'SIGTERM');

        expect(clusterMock.fork).toHaveBeenCalledTimes(forkCountBefore);
    });

    test('defaults numCPUs to 1 when WORKER_COUNT is unset, so isPrimary alone does not trigger forking', async () => {
        const { clusterMock, initializeMock } = loadIndex({ isPrimary: true, workerCount: undefined });
        await flush();

        expect(clusterMock.fork).not.toHaveBeenCalled();
        expect(initializeMock).toHaveBeenCalledTimes(1);
    });

    describe('CLUSTER_SCHEDULING=least_busy', () => {
        const exitHandlers = (clusterMock) =>
            clusterMock.on.mock.calls.filter(([event]) => event === 'exit').map(([, handler]) => handler);

        test('primary listens on the service port itself, before forking any worker', async () => {
            const { netMock, netServer, order } = loadIndex({
                isPrimary: true,
                workerCount: 2,
                clusterScheduling: 'least_busy'
            });
            await flush();

            expect(netMock.createServer).toHaveBeenCalledWith({ pauseOnConnect: true }, expect.any(Function));
            expect(netServer.listen).toHaveBeenCalledWith(3000, expect.any(Function));
            expect(order).toEqual(['listen', 'fork', 'fork']);
        });

        test('primary closes its listener only after the last worker exits during shutdown', async () => {
            const processOnSpy = jestGlobal.spyOn(process, 'on').mockImplementation(() => process);
            const { clusterMock, netServer } = loadIndex({
                isPrimary: true,
                workerCount: 2,
                clusterScheduling: 'least_busy'
            });
            await flush();
            const forkHandler = clusterMock.on.mock.calls.find(([event]) => event === 'fork')[1];
            forkHandler({ id: 1 });
            forkHandler({ id: 2 });
            processOnSpy.mock.calls.find(([event]) => event === 'SIGTERM')[1]();

            const exitWorker = (id) => exitHandlers(clusterMock).forEach((handler) => handler({ id, process: { pid: id } }, 0, null));
            exitWorker(1);
            expect(netServer.close).not.toHaveBeenCalled();
            exitWorker(2);
            expect(netServer.close).toHaveBeenCalledTimes(1);
        });

        test('worker passes a load reporter to createServer', async () => {
            const { createServerMock } = loadIndex({ workerCount: 2, clusterScheduling: 'least_busy' });
            await flush();

            const { workerLoadReporter } = createServerMock.mock.calls[0][1];
            expect(typeof workerLoadReporter.attach).toBe('function');
            expect(typeof workerLoadReporter.markDraining).toBe('function');
        });

        test.each([
            ['the default policy', { workerCount: 2 }],
            ['a single worker, which has nothing to balance', { workerCount: 1, clusterScheduling: 'least_busy' }]
        ])('worker keeps listening itself under %s', async (_name, options) => {
            const { createServerMock } = loadIndex(options);
            await flush();

            expect(createServerMock.mock.calls[0][1]).toEqual({ workerLoadReporter: undefined });
        });

        test('primary keeps Node round-robin under the default policy', async () => {
            const { netMock } = loadIndex({ isPrimary: true, workerCount: 2 });
            await flush();

            expect(netMock.createServer).not.toHaveBeenCalled();
        });
    });
});
