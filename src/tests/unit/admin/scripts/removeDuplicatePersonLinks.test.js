'use strict';

const { describe, test, expect, afterEach, jest } = require('@jest/globals');
const { SimpleContainer } = require('../../../../utils/simpleContainer');

const SCRIPT_PATH = '../../../../admin/scripts/removeDuplicatePersonLinks';
const RUNNER_PATH = '../../../../admin/runners/removeDuplicatePersonLinkRunner';
const CONTAINER_PATH = '../../../../createContainer';
const CLI_PARSER_PATH = '../../../../admin/scripts/commandLineParser';

function buildContainer (overrides = {}) {
    const container = new SimpleContainer();
    Object.assign(container, {
        mongoDatabaseManager: { marker: 'mongoDatabaseManager' },
        preSaveManager: { marker: 'preSaveManager' }
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

    jest.doMock(RUNNER_PATH, () => ({ RemoveDuplicatePersonLinkRunner: MockRunner }));
    jest.doMock(CONTAINER_PATH, () => ({ createContainer: jest.fn(() => buildContainer()) }));
    jest.doMock(CLI_PARSER_PATH, () => ({ CommandLineParser: { parseCommandLine: () => parameters } }));

    const exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => undefined);
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);

    require(SCRIPT_PATH);
    await flushAsync();

    return { MockRunner, mockProcessAsync, exitSpy, errorSpy };
}

describe('admin/scripts/removeDuplicatePersonLinks.js', () => {
    afterEach(() => {
        jest.restoreAllMocks();
        delete process.env.BULK_BUFFER_SIZE;
    });

    test('batchSize uses the CLI parameter when supplied', async () => {
        const { MockRunner } = await runScript({ batchSize: 33 });
        expect(MockRunner.mock.calls[0][0].batchSize).toBe(33);
    });

    test('batchSize falls back to BULK_BUFFER_SIZE env var when parameter absent', async () => {
        process.env.BULK_BUFFER_SIZE = '444';
        const { MockRunner } = await runScript({});
        expect(MockRunner.mock.calls[0][0].batchSize).toBe('444');
    });

    test('batchSize defaults to 10000 when neither parameter nor env var is set', async () => {
        const { MockRunner } = await runScript({});
        expect(MockRunner.mock.calls[0][0].batchSize).toBe(10000);
    });

    test('personUuids splits a comma-separated list', async () => {
        const { MockRunner } = await runScript({ personUuids: 'uuid-a,uuid-b' });
        expect(MockRunner.mock.calls[0][0].personUuids).toEqual(['uuid-a', 'uuid-b']);
    });

    test('personUuids is undefined when not supplied', async () => {
        const { MockRunner } = await runScript({});
        expect(MockRunner.mock.calls[0][0].personUuids).toBeUndefined();
    });

    test('ownerCode is forwarded when supplied and undefined otherwise', async () => {
        const withCode = await runScript({ ownerCode: 'bwell' });
        expect(withCode.MockRunner.mock.calls[0][0].ownerCode).toBe('bwell');
        const withoutCode = await runScript({});
        expect(withoutCode.MockRunner.mock.calls[0][0].ownerCode).toBeUndefined();
    });

    test('uuidGreaterThan is forwarded when supplied and undefined otherwise', async () => {
        const withVal = await runScript({ uuidGreaterThan: '60185667-f6c5-5534-8980-90448606be94' });
        expect(withVal.MockRunner.mock.calls[0][0].uuidGreaterThan).toBe('60185667-f6c5-5534-8980-90448606be94');
        const withoutVal = await runScript({});
        expect(withoutVal.MockRunner.mock.calls[0][0].uuidGreaterThan).toBeUndefined();
    });

    test('limit and skip are forwarded raw from parameters without coercion', async () => {
        const { MockRunner } = await runScript({ limit: 10, skip: 5 });
        expect(MockRunner.mock.calls[0][0].limit).toBe(10);
        expect(MockRunner.mock.calls[0][0].skip).toBe(5);
    });

    test('forwards mongoDatabaseManager and preSaveManager from the container unchanged', async () => {
        const { MockRunner } = await runScript({});
        expect(MockRunner.mock.calls[0][0].mongoDatabaseManager).toEqual({ marker: 'mongoDatabaseManager' });
        expect(MockRunner.mock.calls[0][0].preSaveManager).toEqual({ marker: 'preSaveManager' });
    });

    test('calls processAsync exactly once and exits with code 0 on success', async () => {
        const { mockProcessAsync, exitSpy } = await runScript({});
        expect(mockProcessAsync).toHaveBeenCalledTimes(1);
        expect(exitSpy).toHaveBeenCalledWith(0);
    });
});
