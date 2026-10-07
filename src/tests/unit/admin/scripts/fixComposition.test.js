'use strict';

const { describe, test, expect, afterEach, jest } = require('@jest/globals');
const { SimpleContainer } = require('../../../../utils/simpleContainer');

const SCRIPT_PATH = '../../../../admin/scripts/fixComposition';
const RUNNER_PATH = '../../../../admin/runners/fixCompositionRunner';
const CONTAINER_PATH = '../../../../createContainer';
const CLI_PARSER_PATH = '../../../../admin/scripts/commandLineParser';

function buildContainer (overrides = {}) {
    const container = new SimpleContainer();
    Object.assign(container, {
        mongoDatabaseManager: { marker: 'mongoDatabaseManager' },
        databaseHistoryFactory: { marker: 'databaseHistoryFactory' }
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

    jest.doMock(RUNNER_PATH, () => ({ FixCompositionRunner: MockRunner }));
    jest.doMock(CONTAINER_PATH, () => ({ createContainer: jest.fn(() => buildContainer()) }));
    jest.doMock(CLI_PARSER_PATH, () => ({ CommandLineParser: { parseCommandLine: () => parameters } }));

    const exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => undefined);
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);

    require(SCRIPT_PATH);
    await flushAsync();

    return { MockRunner, mockProcessAsync, exitSpy, errorSpy };
}

describe('admin/scripts/fixComposition.js', () => {
    afterEach(() => {
        jest.restoreAllMocks();
        delete process.env.BULK_BUFFER_SIZE;
    });

    test('batchSize uses the CLI parameter when supplied', async () => {
        const { MockRunner } = await runScript({ batchSize: 10000 });
        expect(MockRunner.mock.calls[0][0].batchSize).toBe(10000);
    });

    test('batchSize falls back to BULK_BUFFER_SIZE env var when parameter absent', async () => {
        process.env.BULK_BUFFER_SIZE = '321';
        const { MockRunner } = await runScript({});
        expect(MockRunner.mock.calls[0][0].batchSize).toBe('321');
    });

    test('batchSize defaults to 1000 (not 10000) when neither parameter nor env var is set', async () => {
        const { MockRunner } = await runScript({});
        expect(MockRunner.mock.calls[0][0].batchSize).toBe(1000);
    });

    test('forwards mongoDatabaseManager and databaseHistoryFactory from the container unchanged', async () => {
        const { MockRunner } = await runScript({});
        expect(MockRunner.mock.calls[0][0].mongoDatabaseManager).toEqual({ marker: 'mongoDatabaseManager' });
        expect(MockRunner.mock.calls[0][0].databaseHistoryFactory).toEqual({ marker: 'databaseHistoryFactory' });
    });

    test('constructs an adminLogger and forwards it to the runner', async () => {
        const { MockRunner } = await runScript({});
        expect(MockRunner.mock.calls[0][0].adminLogger).toBeDefined();
        expect(typeof MockRunner.mock.calls[0][0].adminLogger.logInfo).toBe('function');
    });

    test('calls processAsync exactly once and exits with code 0 on success', async () => {
        const { mockProcessAsync, exitSpy } = await runScript({});
        expect(mockProcessAsync).toHaveBeenCalledTimes(1);
        expect(exitSpy).toHaveBeenCalledWith(0);
    });

    test('does not call process.exit before processAsync resolves', async () => {
        let resolveProcessAsync;
        const pendingPromise = new Promise((resolve) => {
            resolveProcessAsync = resolve;
        });
        jest.resetModules();
        const MockRunner = jest.fn().mockImplementation(function (args) {
            this.constructorArgs = args;
            this.processAsync = jest.fn().mockReturnValue(pendingPromise);
        });
        jest.doMock(RUNNER_PATH, () => ({ FixCompositionRunner: MockRunner }));
        jest.doMock(CONTAINER_PATH, () => ({ createContainer: jest.fn(() => buildContainer()) }));
        jest.doMock(CLI_PARSER_PATH, () => ({ CommandLineParser: { parseCommandLine: () => ({}) } }));
        const exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => undefined);

        require(SCRIPT_PATH);
        await flushAsync(5);
        expect(exitSpy).not.toHaveBeenCalled();

        resolveProcessAsync();
        await flushAsync();
        expect(exitSpy).toHaveBeenCalledWith(0);
    });
});
