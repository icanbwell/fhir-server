'use strict';

const { describe, test, expect, afterEach, jest } = require('@jest/globals');
const { SimpleContainer } = require('../../../../utils/simpleContainer');

const SCRIPT_PATH = '../../../../admin/scripts/dbStats';
const RUNNER_PATH = '../../../../admin/runners/dbStatsRunner.js';
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

async function runScript (parameters) {
    jest.resetModules();

    const mockProcessAsync = jest.fn().mockResolvedValue(undefined);
    const MockRunner = jest.fn().mockImplementation(function (args) {
        this.constructorArgs = args;
        this.processAsync = mockProcessAsync;
    });

    jest.doMock(RUNNER_PATH, () => ({ DatabaseStats: MockRunner }));
    jest.doMock(CONTAINER_PATH, () => ({ createContainer: jest.fn(() => buildContainer()) }));
    jest.doMock(CLI_PARSER_PATH, () => ({ CommandLineParser: { parseCommandLine: () => parameters } }));

    const exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => undefined);
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);

    require(SCRIPT_PATH);
    await flushAsync();

    return { MockRunner, mockProcessAsync, exitSpy, errorSpy };
}

describe('admin/scripts/dbStats.js', () => {
    afterEach(() => {
        jest.restoreAllMocks();
    });

    test('splits comma-separated collections into an array', async () => {
        const { MockRunner } = await runScript({ collections: 'Task_4_0_0,Patient_4_0_0' });
        expect(MockRunner.mock.calls[0][0].collections).toEqual(['Task_4_0_0', 'Patient_4_0_0']);
    });

    test('collections is undefined when not supplied', async () => {
        const { MockRunner } = await runScript({});
        expect(MockRunner.mock.calls[0][0].collections).toBeUndefined();
    });

    test('a single collection name (no commas) is wrapped in a one-element array', async () => {
        const { MockRunner } = await runScript({ collections: 'Task_4_0_0' });
        expect(MockRunner.mock.calls[0][0].collections).toEqual(['Task_4_0_0']);
    });

    test('forwards mongoDatabaseManager from the container unchanged', async () => {
        const { MockRunner } = await runScript({});
        expect(MockRunner.mock.calls[0][0].mongoDatabaseManager).toEqual({ marker: 'mongoDatabaseManager' });
    });

    test('constructs an adminLogger and forwards the same instance to the runner', async () => {
        const { MockRunner } = await runScript({});
        expect(typeof MockRunner.mock.calls[0][0].adminLogger.logInfo).toBe('function');
    });

    test('calls processAsync exactly once and exits with code 0 on success', async () => {
        const { mockProcessAsync, exitSpy } = await runScript({});
        expect(mockProcessAsync).toHaveBeenCalledTimes(1);
        expect(exitSpy).toHaveBeenCalledWith(0);
    });
});
