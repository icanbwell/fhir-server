'use strict';

const { describe, test, expect, afterEach, jest } = require('@jest/globals');
const { SimpleContainer } = require('../../../../utils/simpleContainer');

/**
 * src/admin/scripts/getProxyPatientUsageData.js's own doc comment documents a
 * `--csvFileName proxyPatientUsage.csv` flag as a usage example, but the script hardcodes
 * `const csvFileName = 'proxyPatientUsage.csv';` and never reads `parameters.csvFileName` at all.
 * Any caller who follows the documented example to pick a different output filename is
 * silently ignored -- the runner always receives the same hardcoded name.
 */

const SCRIPT_PATH = '../../../../admin/scripts/getProxyPatientUsageData';
const RUNNER_PATH = '../../../../admin/runners/getProxyPatientUsageDataRunner';
const CONTAINER_PATH = '../../../../createContainer';
const CLI_PARSER_PATH = '../../../../admin/scripts/commandLineParser';

function buildContainer (overrides = {}) {
    const container = new SimpleContainer();
    Object.assign(container, {
        mongoDatabaseManager: { marker: 'mongoDatabaseManager' },
        databaseQueryFactory: { marker: 'databaseQueryFactory' }
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

    jest.doMock(RUNNER_PATH, () => ({ GetProxyPatientUsageDataRunner: MockRunner }));
    jest.doMock(CONTAINER_PATH, () => ({ createContainer: jest.fn(() => buildContainer()) }));
    jest.doMock(CLI_PARSER_PATH, () => ({ CommandLineParser: { parseCommandLine: () => parameters } }));

    const exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => undefined);
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);

    require(SCRIPT_PATH);
    await flushAsync();

    return { MockRunner, mockProcessAsync, exitSpy, logSpy, errorSpy };
}

describe('admin/scripts/getProxyPatientUsageData.js', () => {
    afterEach(() => {
        jest.restoreAllMocks();
        delete process.env.BULK_BUFFER_SIZE;
    });

    test('collections splits a caller-supplied comma-separated list', async () => {
        const { MockRunner } = await runScript({ collections: 'Observation_4_0_0,Condition_4_0_0' });
        expect(MockRunner.mock.calls[0][0].collections).toEqual(['Observation_4_0_0', 'Condition_4_0_0']);
    });

    test('collections defaults to ["all"] when not supplied', async () => {
        const { MockRunner } = await runScript({});
        expect(MockRunner.mock.calls[0][0].collections).toEqual(['all']);
    });

    test('batchSize uses the CLI parameter when supplied', async () => {
        const { MockRunner } = await runScript({ batchSize: 1000 });
        expect(MockRunner.mock.calls[0][0].batchSize).toBe(1000);
    });

    test('batchSize falls back to BULK_BUFFER_SIZE env var when parameter absent', async () => {
        process.env.BULK_BUFFER_SIZE = '2222';
        const { MockRunner } = await runScript({});
        expect(MockRunner.mock.calls[0][0].batchSize).toBe('2222');
    });

    test('batchSize defaults to 10000 when neither parameter nor env var is set', async () => {
        const { MockRunner } = await runScript({});
        expect(MockRunner.mock.calls[0][0].batchSize).toBe(10000);
    });

    test('csvFileName is always "proxyPatientUsage.csv" (hardcoded, no parameter influences it)', async () => {
        const { MockRunner } = await runScript({});
        expect(MockRunner.mock.calls[0][0].csvFileName).toBe('proxyPatientUsage.csv');
    });

    // A caller-supplied --csvFileName being silently ignored is covered as a
    // failing-by-design test in getProxyPatientUsageData.bugs.test.js, kept separate
    // so this suite stays green.

    test('forwards mongoDatabaseManager and databaseQueryFactory from the container unchanged', async () => {
        const { MockRunner } = await runScript({});
        expect(MockRunner.mock.calls[0][0].mongoDatabaseManager).toEqual({ marker: 'mongoDatabaseManager' });
        expect(MockRunner.mock.calls[0][0].databaseQueryFactory).toEqual({ marker: 'databaseQueryFactory' });
    });

    test('calls processAsync exactly once and exits with code 0 on success', async () => {
        const { mockProcessAsync, exitSpy } = await runScript({});
        expect(mockProcessAsync).toHaveBeenCalledTimes(1);
        expect(exitSpy).toHaveBeenCalledWith(0);
    });
});
