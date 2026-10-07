'use strict';

const { describe, test, expect, afterEach, jest } = require('@jest/globals');
const { SimpleContainer } = require('../../../../utils/simpleContainer');

/**
 * src/admin/scripts/migrateHistoryToCloudStorage.js imports FixMultipleOwnerTagsRunner but never
 * uses it (dead import) -- an observation, not a bug, since requiring the unused module has no
 * behavioral effect. The real logic under test here is the batchSize fallback chain and the
 * `parameters.collection` -> `collectionName` rename.
 */

const SCRIPT_PATH = '../../../../admin/scripts/migrateHistoryToCloudStorage';
const RUNNER_PATH = '../../../../admin/runners/migrateHistoryToCloudStorageRunner';
const FIX_OWNER_TAGS_RUNNER_PATH = '../../../../admin/runners/fixMultipleOwnerTagsRunner';
const CONTAINER_PATH = '../../../../createContainer';
const CLI_PARSER_PATH = '../../../../admin/scripts/commandLineParser';

function buildContainer (overrides = {}) {
    const container = new SimpleContainer();
    Object.assign(container, {
        mongoDatabaseManager: { marker: 'mongoDatabaseManager' },
        historyResourceCloudStorageClient: { marker: 'historyResourceCloudStorageClient' },
        configManager: { marker: 'configManager' }
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

    jest.doMock(RUNNER_PATH, () => ({ MigrateHistoryToCloudStorageRunner: MockRunner }));
    jest.doMock(FIX_OWNER_TAGS_RUNNER_PATH, () => ({ FixMultipleOwnerTagsRunner: jest.fn() }));
    jest.doMock(CONTAINER_PATH, () => ({ createContainer: jest.fn(() => buildContainer()) }));
    jest.doMock(CLI_PARSER_PATH, () => ({ CommandLineParser: { parseCommandLine: () => parameters } }));

    const exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => undefined);
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);

    require(SCRIPT_PATH);
    await flushAsync();

    return { MockRunner, mockProcessAsync, exitSpy, errorSpy };
}

describe('admin/scripts/migrateHistoryToCloudStorage.js', () => {
    afterEach(() => {
        jest.restoreAllMocks();
        delete process.env.BULK_BUFFER_SIZE;
    });

    test('batchSize uses the CLI parameter when supplied', async () => {
        const { MockRunner } = await runScript({ batchSize: 250 });
        expect(MockRunner.mock.calls[0][0].batchSize).toBe(250);
    });

    test('batchSize falls back to BULK_BUFFER_SIZE env var when parameter absent', async () => {
        process.env.BULK_BUFFER_SIZE = '600';
        const { MockRunner } = await runScript({});
        expect(MockRunner.mock.calls[0][0].batchSize).toBe('600');
    });

    test('batchSize defaults to 1000 (not 10000) when neither parameter nor env var is set', async () => {
        const { MockRunner } = await runScript({});
        expect(MockRunner.mock.calls[0][0].batchSize).toBe(1000);
    });

    test('collectionName is derived from the CLI --collection flag', async () => {
        const { MockRunner } = await runScript({ collection: 'Binary_4_0_0_History' });
        expect(MockRunner.mock.calls[0][0].collectionName).toBe('Binary_4_0_0_History');
    });

    test('limit and startAfterId are forwarded raw from parameters', async () => {
        const { MockRunner } = await runScript({ limit: 100000, startAfterId: '67b3730e0c1612400384e36a' });
        expect(MockRunner.mock.calls[0][0].limit).toBe(100000);
        expect(MockRunner.mock.calls[0][0].startAfterId).toBe('67b3730e0c1612400384e36a');
    });

    test('forwards historyResourceCloudStorageClient and configManager from the container unchanged', async () => {
        const { MockRunner } = await runScript({});
        expect(MockRunner.mock.calls[0][0].historyResourceCloudStorageClient).toEqual({ marker: 'historyResourceCloudStorageClient' });
        expect(MockRunner.mock.calls[0][0].configManager).toEqual({ marker: 'configManager' });
    });

    test('forwards mongoDatabaseManager from the container unchanged', async () => {
        const { MockRunner } = await runScript({});
        expect(MockRunner.mock.calls[0][0].mongoDatabaseManager).toEqual({ marker: 'mongoDatabaseManager' });
    });

    test('calls processAsync exactly once and exits with code 0 on success', async () => {
        const { mockProcessAsync, exitSpy } = await runScript({});
        expect(mockProcessAsync).toHaveBeenCalledTimes(1);
        expect(exitSpy).toHaveBeenCalledWith(0);
    });
});
