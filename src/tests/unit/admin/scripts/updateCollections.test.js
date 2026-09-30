'use strict';

const { describe, test, expect, afterEach, jest } = require('@jest/globals');
const { SimpleContainer } = require('../../../../utils/simpleContainer');

/**
 * src/admin/scripts/updateCollections.js is a thin CLI entry point: it parses argv via
 * CommandLineParser, derives constructor params (with several fallback/coercion rules), wires an
 * UpdateCollectionsRunner into the IoC container and calls processAsync().
 *
 * Because `main()` is not exported and runs immediately on require (module.exports is empty),
 * the only way to exercise the real parameter-derivation logic is to require the module with its
 * dependencies mocked and observe what the (mocked) UpdateCollectionsRunner constructor receives.
 * This is a narrow integration test per test-density-rules.md: real internal wiring, mocked I/O.
 */

const SCRIPT_PATH = '../../../../admin/scripts/updateCollections';
const RUNNER_PATH = '../../../../admin/runners/updateCollectionsRunner';
const CONTAINER_PATH = '../../../../createContainer';
const CLI_PARSER_PATH = '../../../../admin/scripts/commandLineParser';

function buildContainer (overrides = {}) {
    const container = new SimpleContainer();
    Object.assign(container, {
        mongoDatabaseManager: { marker: 'mongoDatabaseManager' }
    }, overrides);
    return container;
}

async function flushAsync (times = 15) {
    for (let i = 0; i < times; i++) {
        await Promise.resolve();
    }
}

/**
 * Loads the script under test with the given CLI parameters and returns the constructor args
 * that UpdateCollectionsRunner was invoked with, plus the mocks for further assertions.
 * @param {Object} parameters
 */
async function runScript (parameters) {
    jest.resetModules();

    const mockProcessAsync = jest.fn().mockResolvedValue(undefined);
    const MockRunner = jest.fn().mockImplementation(function (args) {
        this.constructorArgs = args;
        this.processAsync = mockProcessAsync;
    });

    jest.doMock(RUNNER_PATH, () => ({ UpdateCollectionsRunner: MockRunner }));
    jest.doMock(CONTAINER_PATH, () => ({ createContainer: jest.fn(() => buildContainer()) }));
    jest.doMock(CLI_PARSER_PATH, () => ({
        CommandLineParser: { parseCommandLine: () => parameters }
    }));

    const exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => undefined);
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);

    require(SCRIPT_PATH);
    await flushAsync();

    return { MockRunner, mockProcessAsync, exitSpy, errorSpy };
}

describe('admin/scripts/updateCollections.js', () => {
    afterEach(() => {
        jest.restoreAllMocks();
        delete process.env.BULK_BUFFER_SIZE;
    });

    test('defaults updatedBefore to 2023-03-14 when not provided', async () => {
        const { MockRunner } = await runScript({});
        expect(MockRunner).toHaveBeenCalledTimes(1);
        const args = MockRunner.mock.calls[0][0];
        expect(args.updatedBefore.toDate().getTime()).toBe(new Date(2023, 2, 14).getTime());
    });

    test('parses a caller-supplied updatedBefore as UTC midnight of that date', async () => {
        const { MockRunner } = await runScript({ updatedBefore: '2024-05-01' });
        const args = MockRunner.mock.calls[0][0];
        expect(args.updatedBefore.toISOString()).toBe(new Date('2024-05-01T00:00:00Z').toISOString());
    });

    test('readBatchSize uses the CLI parameter when supplied', async () => {
        const { MockRunner } = await runScript({ readBatchSize: 250 });
        expect(MockRunner.mock.calls[0][0].readBatchSize).toBe(250);
    });

    test('readBatchSize falls back to BULK_BUFFER_SIZE env var when parameter absent', async () => {
        process.env.BULK_BUFFER_SIZE = '777';
        const { MockRunner } = await runScript({});
        expect(MockRunner.mock.calls[0][0].readBatchSize).toBe('777');
    });

    test('readBatchSize defaults to 10000 when neither parameter nor env var is set', async () => {
        const { MockRunner } = await runScript({});
        expect(MockRunner.mock.calls[0][0].readBatchSize).toBe(10000);
    });

    test('concurrentRunners defaults to 1 when not supplied', async () => {
        const { MockRunner } = await runScript({});
        expect(MockRunner.mock.calls[0][0].concurrentRunners).toBe(1);
    });

    test('concurrentRunners is passed through when supplied', async () => {
        const { MockRunner } = await runScript({ concurrentRunners: 5 });
        expect(MockRunner.mock.calls[0][0].concurrentRunners).toBe(5);
    });

    test('splits comma-separated collections into an array', async () => {
        const { MockRunner } = await runScript({ collections: 'Patient_4_0_0,Task_4_0_0' });
        expect(MockRunner.mock.calls[0][0].collections).toEqual(['Patient_4_0_0', 'Task_4_0_0']);
    });

    test('leaves collections undefined when not supplied', async () => {
        const { MockRunner } = await runScript({});
        expect(MockRunner.mock.calls[0][0].collections).toBeUndefined();
    });

    test('coerces _idAbove to a String when supplied as a number', async () => {
        const { MockRunner } = await runScript({ _idAbove: 12345 });
        expect(MockRunner.mock.calls[0][0]._idAbove).toBe('12345');
        expect(typeof MockRunner.mock.calls[0][0]._idAbove).toBe('string');
    });

    test('coerces skipHistoryCollections to a strict boolean via !!', async () => {
        const truthy = await runScript({ skipHistoryCollections: 'yes' });
        expect(truthy.MockRunner.mock.calls[0][0].skipHistoryCollections).toBe(true);

        const falsy = await runScript({});
        expect(falsy.MockRunner.mock.calls[0][0].skipHistoryCollections).toBe(false);
    });

    test('calls processAsync exactly once and exits with code 0 on success', async () => {
        const { mockProcessAsync, exitSpy } = await runScript({});
        expect(mockProcessAsync).toHaveBeenCalledTimes(1);
        expect(exitSpy).toHaveBeenCalledWith(0);
    });

    test('forwards the container mongoDatabaseManager to the runner unchanged', async () => {
        const { MockRunner } = await runScript({});
        expect(MockRunner.mock.calls[0][0].mongoDatabaseManager).toEqual({ marker: 'mongoDatabaseManager' });
    });
});
