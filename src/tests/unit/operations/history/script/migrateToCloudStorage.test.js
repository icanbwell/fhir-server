'use strict';

const { describe, test, expect, afterEach, jest } = require('@jest/globals');
const { SimpleContainer } = require('../../../../../utils/simpleContainer');

/**
 * src/operations/history/script/migrateToCloudStorage.js is the same CLI-wrapper shape as the
 * admin/scripts/*.js scripts, but lives under operations/history/script and uses logInfo/logError
 * directly instead of AdminLogger. Its default batchSize (100) differs from every admin/scripts
 * sibling (1000 or 10000) -- pinned explicitly below since it is easy to typo/regress.
 */

const SCRIPT_PATH = '../../../../../operations/history/script/migrateToCloudStorage';
const RUNNER_PATH = '../../../../../operations/history/script/migrateToCloudStorageRunner';
const CONTAINER_PATH = '../../../../../createContainer';
const CLI_PARSER_PATH = '../../../../../admin/scripts/commandLineParser';

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

    jest.doMock(RUNNER_PATH, () => ({ MigrateToCloudStorageRunner: MockRunner }));
    jest.doMock(CONTAINER_PATH, () => ({ createContainer: jest.fn(() => buildContainer()) }));
    jest.doMock(CLI_PARSER_PATH, () => ({ CommandLineParser: { parseCommandLine: () => parameters } }));

    const exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => undefined);
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);

    require(SCRIPT_PATH);
    await flushAsync();

    return { MockRunner, mockProcessAsync, exitSpy, errorSpy };
}

describe('operations/history/script/migrateToCloudStorage.js', () => {
    afterEach(() => {
        jest.restoreAllMocks();
        delete process.env.BULK_BUFFER_SIZE;
    });

    test('batchSize uses the CLI parameter when supplied', async () => {
        const { MockRunner } = await runScript({ batchSize: 50 });
        expect(MockRunner.mock.calls[0][0].batchSize).toBe(50);
    });

    test('batchSize falls back to BULK_BUFFER_SIZE env var when parameter absent', async () => {
        process.env.BULK_BUFFER_SIZE = '250';
        const { MockRunner } = await runScript({});
        expect(MockRunner.mock.calls[0][0].batchSize).toBe('250');
    });

    test('batchSize defaults to 100 (distinct from sibling admin scripts) when neither parameter nor env var is set', async () => {
        const { MockRunner } = await runScript({});
        expect(MockRunner.mock.calls[0][0].batchSize).toBe(100);
    });

    test('collectionName is derived from the CLI --collection flag', async () => {
        const { MockRunner } = await runScript({ collection: 'Binary_4_0_0_History' });
        expect(MockRunner.mock.calls[0][0].collectionName).toBe('Binary_4_0_0_History');
    });

    test('limit is forwarded raw from parameters', async () => {
        const { MockRunner } = await runScript({ limit: 100000 });
        expect(MockRunner.mock.calls[0][0].limit).toBe(100000);
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
