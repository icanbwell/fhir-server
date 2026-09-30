'use strict';

const { describe, test, expect, afterEach, jest } = require('@jest/globals');
const { SimpleContainer } = require('../../../../utils/simpleContainer');

const SCRIPT_PATH = '../../../../admin/scripts/dumpPersons';
const RUNNER_PATH = '../../../../admin/runners/dumpPersonsRunner';
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

    jest.doMock(RUNNER_PATH, () => ({ DumpPersonsRunner: MockRunner }));
    jest.doMock(CONTAINER_PATH, () => ({ createContainer: jest.fn(() => buildContainer()) }));
    jest.doMock(CLI_PARSER_PATH, () => ({ CommandLineParser: { parseCommandLine: () => parameters } }));

    const exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => undefined);
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);

    require(SCRIPT_PATH);
    await flushAsync();

    return { MockRunner, mockProcessAsync, exitSpy, logSpy, errorSpy };
}

describe('admin/scripts/dumpPersons.js', () => {
    afterEach(() => {
        jest.restoreAllMocks();
        delete process.env.BULK_BUFFER_SIZE;
    });

    test('batchSize uses the CLI parameter when supplied', async () => {
        const { MockRunner } = await runScript({ batchSize: 200 });
        expect(MockRunner.mock.calls[0][0].batchSize).toBe(200);
    });

    test('batchSize falls back to BULK_BUFFER_SIZE env var when parameter absent', async () => {
        process.env.BULK_BUFFER_SIZE = '150';
        const { MockRunner } = await runScript({});
        expect(MockRunner.mock.calls[0][0].batchSize).toBe('150');
    });

    test('batchSize defaults to 1000 when neither parameter nor env var is set', async () => {
        const { MockRunner } = await runScript({});
        expect(MockRunner.mock.calls[0][0].batchSize).toBe(1000);
    });

    test('forwards accessCode, beforeDate, outputFile and pageSize straight through', async () => {
        const { MockRunner } = await runScript({
            accessCode: 'bWell',
            beforeDate: '2023-04-22T00:00:00Z',
            outputFile: 'dump',
            pageSize: 50000
        });
        const args = MockRunner.mock.calls[0][0];
        expect(args.accessCode).toBe('bWell');
        expect(args.beforeDate).toBe('2023-04-22T00:00:00Z');
        expect(args.outputFile).toBe('dump');
        expect(args.pageSize).toBe(50000);
    });

    test('accessCode, beforeDate, outputFile and pageSize are undefined when not supplied', async () => {
        const { MockRunner } = await runScript({});
        const args = MockRunner.mock.calls[0][0];
        expect(args.accessCode).toBeUndefined();
        expect(args.beforeDate).toBeUndefined();
        expect(args.outputFile).toBeUndefined();
        expect(args.pageSize).toBeUndefined();
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
