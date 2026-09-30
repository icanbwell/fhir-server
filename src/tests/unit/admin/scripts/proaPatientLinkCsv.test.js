'use strict';

const { describe, test, expect, afterEach, jest } = require('@jest/globals');
const { SimpleContainer } = require('../../../../utils/simpleContainer');

const SCRIPT_PATH = '../../../../admin/scripts/proaPatientLinkCsv';
const RUNNER_PATH = '../../../../admin/runners/proaPatientLinkCsvRunner';
const CONTAINER_PATH = '../../../../createContainer';
const CLI_PARSER_PATH = '../../../../admin/scripts/commandLineParser';

function buildContainer (overrides = {}) {
    const container = new SimpleContainer();
    Object.assign(container, {
        mongoDatabaseManager: { marker: 'mongoDatabaseManager' },
        personMatchManager: { marker: 'personMatchManager' }
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

    jest.doMock(RUNNER_PATH, () => ({ ProaPatientLinkCsvRunner: MockRunner }));
    jest.doMock(CONTAINER_PATH, () => ({ createContainer: jest.fn(() => buildContainer()) }));
    jest.doMock(CLI_PARSER_PATH, () => ({ CommandLineParser: { parseCommandLine: () => parameters } }));

    const exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => undefined);
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);

    require(SCRIPT_PATH);
    await flushAsync();

    return { MockRunner, mockProcessAsync, exitSpy, errorSpy };
}

describe('admin/scripts/proaPatientLinkCsv.js', () => {
    afterEach(() => {
        jest.restoreAllMocks();
        delete process.env.BULK_BUFFER_SIZE;
    });

    test('batchSize uses the CLI parameter when supplied', async () => {
        const { MockRunner } = await runScript({ batchSize: 77 });
        expect(MockRunner.mock.calls[0][0].batchSize).toBe(77);
    });

    test('batchSize falls back to BULK_BUFFER_SIZE env var when parameter absent', async () => {
        process.env.BULK_BUFFER_SIZE = '555';
        const { MockRunner } = await runScript({});
        expect(MockRunner.mock.calls[0][0].batchSize).toBe('555');
    });

    test('batchSize defaults to 10000 when neither parameter nor env var is set', async () => {
        const { MockRunner } = await runScript({});
        expect(MockRunner.mock.calls[0][0].batchSize).toBe(10000);
    });

    test('clientSourceAssigningAuthorities defaults to ["bwell_demo"] when not supplied', async () => {
        const { MockRunner } = await runScript({});
        expect(MockRunner.mock.calls[0][0].clientSourceAssigningAuthorities).toEqual(['bwell_demo']);
    });

    test('clientSourceAssigningAuthorities splits a caller-supplied comma-separated list', async () => {
        const { MockRunner } = await runScript({ clientSourceAssigningAuthorities: 'client-a,client-b' });
        expect(MockRunner.mock.calls[0][0].clientSourceAssigningAuthorities).toEqual(['client-a', 'client-b']);
    });

    test('skipAlreadyLinked is coerced to a strict boolean via !!', async () => {
        const on = await runScript({ skipAlreadyLinked: 'x' });
        expect(on.MockRunner.mock.calls[0][0].skipAlreadyLinked).toBe(true);
        const off = await runScript({});
        expect(off.MockRunner.mock.calls[0][0].skipAlreadyLinked).toBe(false);
    });

    test('getProaPatientClientPersonMatching is coerced independently of skipAlreadyLinked', async () => {
        const { MockRunner } = await runScript({ getProaPatientClientPersonMatching: true, skipAlreadyLinked: false });
        expect(MockRunner.mock.calls[0][0].getProaPatientClientPersonMatching).toBe(true);
        expect(MockRunner.mock.calls[0][0].skipAlreadyLinked).toBe(false);
    });

    test('forwards mongoDatabaseManager and personMatchManager from the container unchanged', async () => {
        const { MockRunner } = await runScript({});
        expect(MockRunner.mock.calls[0][0].mongoDatabaseManager).toEqual({ marker: 'mongoDatabaseManager' });
        expect(MockRunner.mock.calls[0][0].personMatchManager).toEqual({ marker: 'personMatchManager' });
    });

    test('calls processAsync exactly once and exits with code 0 on success', async () => {
        const { mockProcessAsync, exitSpy } = await runScript({});
        expect(mockProcessAsync).toHaveBeenCalledTimes(1);
        expect(exitSpy).toHaveBeenCalledWith(0);
    });
});
