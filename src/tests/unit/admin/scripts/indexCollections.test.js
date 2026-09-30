'use strict';

const { describe, test, expect, afterEach, jest } = require('@jest/globals');
const { SimpleContainer } = require('../../../../utils/simpleContainer');

/**
 * src/admin/scripts/indexCollections.js is a thin CLI wrapper, but it contains real branching:
 * a `collections=all` special case and seven independent !!-coercions feeding IndexCollectionsRunner.
 * Since `main()` is unexported and self-invokes at require time, we require the module with its
 * dependencies mocked and inspect what IndexCollectionsRunner's constructor actually received.
 */

const SCRIPT_PATH = '../../../../admin/scripts/indexCollections';
const RUNNER_PATH = '../../../../admin/runners/indexCollectionsRunner';
const CONTAINER_PATH = '../../../../createContainer';
const CLI_PARSER_PATH = '../../../../admin/scripts/commandLineParser';

function buildContainer (overrides = {}) {
    const container = new SimpleContainer();
    Object.assign(container, {
        indexManager: { marker: 'indexManager' },
        mongoDatabaseManager: { marker: 'mongoDatabaseManager' }
    }, overrides);
    return container;
}

async function flushAsync (times = 15) {
    for (let i = 0; i < times; i++) {
        await Promise.resolve();
    }
}

async function runScript (parameters) {
    jest.resetModules();

    const mockProcessAsync = jest.fn().mockResolvedValue(undefined);
    const MockRunner = jest.fn().mockImplementation(function (args) {
        this.constructorArgs = args;
        this.processAsync = mockProcessAsync;
    });

    jest.doMock(RUNNER_PATH, () => ({ IndexCollectionsRunner: MockRunner }));
    jest.doMock(CONTAINER_PATH, () => ({ createContainer: jest.fn(() => buildContainer()) }));
    jest.doMock(CLI_PARSER_PATH, () => ({ CommandLineParser: { parseCommandLine: () => parameters } }));

    const exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => undefined);
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);

    require(SCRIPT_PATH);
    await flushAsync();

    return { MockRunner, mockProcessAsync, exitSpy, errorSpy };
}

describe('admin/scripts/indexCollections.js', () => {
    afterEach(() => {
        jest.restoreAllMocks();
    });

    test('splits comma-separated collections and trims whitespace', async () => {
        const { MockRunner } = await runScript({ collections: 'Patient_4_0_0, Task_4_0_0 ' });
        expect(MockRunner.mock.calls[0][0].collections).toEqual(['Patient_4_0_0', 'Task_4_0_0']);
    });

    test('collections="all" becomes the literal single-element array ["all"]', async () => {
        const { MockRunner } = await runScript({ collections: 'all' });
        expect(MockRunner.mock.calls[0][0].collections).toEqual(['all']);
    });

    test('collections defaults to an empty array when not supplied', async () => {
        const { MockRunner } = await runScript({});
        expect(MockRunner.mock.calls[0][0].collections).toEqual([]);
    });

    test('dropIndexes is coerced to strict boolean via !!parameters.drop', async () => {
        const on = await runScript({ drop: 'true' });
        expect(on.MockRunner.mock.calls[0][0].dropIndexes).toBe(true);
        const off = await runScript({});
        expect(off.MockRunner.mock.calls[0][0].dropIndexes).toBe(false);
    });

    test('useAuditDatabase reflects parameters.audit independently of other flags', async () => {
        const { MockRunner } = await runScript({ audit: true, drop: false });
        expect(MockRunner.mock.calls[0][0].useAuditDatabase).toBe(true);
        expect(MockRunner.mock.calls[0][0].dropIndexes).toBe(false);
    });

    test('useAccessLogsDatabase reflects parameters.accessLogs', async () => {
        const { MockRunner } = await runScript({ accessLogs: 1 });
        expect(MockRunner.mock.calls[0][0].useAccessLogsDatabase).toBe(true);
    });

    test('addMissingIndexesOnly and removeExtraIndexesOnly are independent flags', async () => {
        const { MockRunner } = await runScript({ addMissingIndexesOnly: true, dropExtraIndexesOnly: false });
        expect(MockRunner.mock.calls[0][0].addMissingIndexesOnly).toBe(true);
        expect(MockRunner.mock.calls[0][0].removeExtraIndexesOnly).toBe(false);
    });

    test('includeHistoryCollections and synchronizeIndexes are coerced independently', async () => {
        const { MockRunner } = await runScript({ includeHistoryCollections: true, synchronize: 'yes' });
        expect(MockRunner.mock.calls[0][0].includeHistoryCollections).toBe(true);
        expect(MockRunner.mock.calls[0][0].synchronizeIndexes).toBe(true);
    });

    test('forwards indexManager and mongoDatabaseManager from the container unchanged', async () => {
        const { MockRunner } = await runScript({});
        expect(MockRunner.mock.calls[0][0].indexManager).toEqual({ marker: 'indexManager' });
        expect(MockRunner.mock.calls[0][0].mongoDatabaseManager).toEqual({ marker: 'mongoDatabaseManager' });
    });

    test('calls processAsync exactly once and exits with code 0 on success', async () => {
        const { mockProcessAsync, exitSpy } = await runScript({});
        expect(mockProcessAsync).toHaveBeenCalledTimes(1);
        expect(exitSpy).toHaveBeenCalledWith(0);
    });
});
