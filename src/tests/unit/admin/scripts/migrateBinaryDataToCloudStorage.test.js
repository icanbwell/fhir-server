'use strict';

const { describe, test, expect, afterEach, jest } = require('@jest/globals');
const { SimpleContainer } = require('../../../../utils/simpleContainer');

/**
 * src/admin/scripts/migrateBinaryDataToCloudStorage.js derives several constructor params with
 * non-trivial fallback rules, most notably thresholdKB: `parameters.thresholdKB !== undefined
 * ? parameters.thresholdKB : container.configManager.base64FieldDataThresholdKB`. Using `!==
 * undefined` (rather than a truthy check) is deliberate so a caller-supplied `0` overrides the
 * config default instead of being treated as "not supplied" -- this test suite pins that.
 */

const SCRIPT_PATH = '../../../../admin/scripts/migrateBinaryDataToCloudStorage';
const RUNNER_PATH = '../../../../admin/runners/migrateBinaryDataToCloudStorageRunner';
const CONTAINER_PATH = '../../../../createContainer';
const CLI_PARSER_PATH = '../../../../admin/scripts/commandLineParser';

function buildContainer (overrides = {}) {
    const container = new SimpleContainer();
    Object.assign(container, {
        mongoDatabaseManager: { marker: 'mongoDatabaseManager' },
        base64FieldCloudStorageClient: { marker: 'base64FieldCloudStorageClient' },
        configManager: { base64FieldDataThresholdKB: 256 }
    }, overrides);
    return container;
}

async function flushAsync (times = 15) {
    for (let i = 0; i < times; i++) {
        await Promise.resolve();
    }
}

async function runScript (parameters, containerOverrides) {
    jest.resetModules();

    const mockProcessAsync = jest.fn().mockResolvedValue(undefined);
    const MockRunner = jest.fn().mockImplementation(function (args) {
        this.constructorArgs = args;
        this.processAsync = mockProcessAsync;
    });

    jest.doMock(RUNNER_PATH, () => ({ MigrateBinaryDataToCloudStorageRunner: MockRunner }));
    jest.doMock(CONTAINER_PATH, () => ({ createContainer: jest.fn(() => buildContainer(containerOverrides)) }));
    jest.doMock(CLI_PARSER_PATH, () => ({ CommandLineParser: { parseCommandLine: () => parameters } }));

    const exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => undefined);
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);

    require(SCRIPT_PATH);
    await flushAsync();

    return { MockRunner, mockProcessAsync, exitSpy, errorSpy };
}

describe('admin/scripts/migrateBinaryDataToCloudStorage.js', () => {
    afterEach(() => {
        jest.restoreAllMocks();
    });

    test('batchSize defaults to 1000 when not supplied', async () => {
        const { MockRunner } = await runScript({});
        expect(MockRunner.mock.calls[0][0].batchSize).toBe(1000);
    });

    test('batchSize uses the CLI parameter when supplied', async () => {
        const { MockRunner } = await runScript({ batchSize: 50 });
        expect(MockRunner.mock.calls[0][0].batchSize).toBe(50);
    });

    test('concurrency defaults to 10 when not supplied', async () => {
        const { MockRunner } = await runScript({});
        expect(MockRunner.mock.calls[0][0].concurrency).toBe(10);
    });

    test('concurrency uses the CLI parameter when supplied', async () => {
        const { MockRunner } = await runScript({ concurrency: 3 });
        expect(MockRunner.mock.calls[0][0].concurrency).toBe(3);
    });

    test('thresholdKB falls back to configManager.base64FieldDataThresholdKB when parameter is absent', async () => {
        const { MockRunner } = await runScript({}, { configManager: { base64FieldDataThresholdKB: 512 } });
        expect(MockRunner.mock.calls[0][0].thresholdKB).toBe(512);
    });

    test('thresholdKB honors an explicit 0 from the caller instead of falling back (boundary check)', async () => {
        const { MockRunner } = await runScript({ thresholdKB: 0 }, { configManager: { base64FieldDataThresholdKB: 512 } });
        expect(MockRunner.mock.calls[0][0].thresholdKB).toBe(0);
    });

    test('thresholdKB uses a positive caller-supplied value over the config default', async () => {
        const { MockRunner } = await runScript({ thresholdKB: 64 }, { configManager: { base64FieldDataThresholdKB: 512 } });
        expect(MockRunner.mock.calls[0][0].thresholdKB).toBe(64);
    });

    test('dryRun defaults to false and is passed through as true when set', async () => {
        const off = await runScript({});
        expect(off.MockRunner.mock.calls[0][0].dryRun).toBe(false);
        const on = await runScript({ dryRun: true });
        expect(on.MockRunner.mock.calls[0][0].dryRun).toBe(true);
    });

    test('uuids parses a comma-separated ids list, trimming whitespace and dropping empties', async () => {
        const { MockRunner } = await runScript({ ids: ' uuid-1 ,uuid-2,, uuid-3 ' });
        expect(MockRunner.mock.calls[0][0].uuids).toEqual(['uuid-1', 'uuid-2', 'uuid-3']);
    });

    test('uuids is undefined when ids is not supplied', async () => {
        const { MockRunner } = await runScript({});
        expect(MockRunner.mock.calls[0][0].uuids).toBeUndefined();
    });

    test('forwards startId, count, fromDate and toDate straight through from parameters', async () => {
        const { MockRunner } = await runScript({
            startId: 'abc123',
            count: 500,
            fromDate: '2024-01-01',
            toDate: '2024-06-01'
        });
        const args = MockRunner.mock.calls[0][0];
        expect(args.startId).toBe('abc123');
        expect(args.count).toBe(500);
        expect(args.fromDate).toBe('2024-01-01');
        expect(args.toDate).toBe('2024-06-01');
    });

    test('forwards base64FieldCloudStorageClient and configManager from the container unchanged', async () => {
        const client = { marker: 'client-x' };
        const { MockRunner } = await runScript({}, { base64FieldCloudStorageClient: client });
        expect(MockRunner.mock.calls[0][0].base64FieldCloudStorageClient).toBe(client);
    });

    test('calls processAsync exactly once and exits with code 0 on success', async () => {
        const { mockProcessAsync, exitSpy } = await runScript({});
        expect(mockProcessAsync).toHaveBeenCalledTimes(1);
        expect(exitSpy).toHaveBeenCalledWith(0);
    });
});
