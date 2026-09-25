'use strict';

const { describe, test, expect, afterEach, jest } = require('@jest/globals');
const { SimpleContainer } = require('../../../../utils/simpleContainer');

const SCRIPT_PATH = '../../../../admin/scripts/createAccessIndexField';
const RUNNER_PATH = '../../../../admin/runners/createAccessIndexFieldRunner';
const CONTAINER_PATH = '../../../../createContainer';
const CLI_PARSER_PATH = '../../../../admin/scripts/commandLineParser';

function buildContainer (overrides = {}) {
    const container = new SimpleContainer();
    Object.assign(container, {
        mongoDatabaseManager: { marker: 'mongoDatabaseManager' },
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

    // Note: the script imports the class under the local name `CreateAccessIndexRunner`,
    // even though the module file is `createAccessIndexFieldRunner.js`.
    jest.doMock(RUNNER_PATH, () => ({ CreateAccessIndexRunner: MockRunner }));
    jest.doMock(CONTAINER_PATH, () => ({ createContainer: jest.fn(() => buildContainer()) }));
    jest.doMock(CLI_PARSER_PATH, () => ({ CommandLineParser: { parseCommandLine: () => parameters } }));

    const exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => undefined);
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);

    require(SCRIPT_PATH);
    await flushAsync();

    return { MockRunner, mockProcessAsync, exitSpy, logSpy, errorSpy };
}

describe('admin/scripts/createAccessIndexField.js', () => {
    afterEach(() => {
        jest.restoreAllMocks();
        delete process.env.BULK_BUFFER_SIZE;
    });

    test('splits comma-separated collections and trims whitespace', async () => {
        const { MockRunner } = await runScript({ collections: 'Practitioner_4_0_0, Patient_4_0_0 ' });
        expect(MockRunner.mock.calls[0][0].collections).toEqual(['Practitioner_4_0_0', 'Patient_4_0_0']);
    });

    test('collections="all" becomes the literal single-element array ["all"]', async () => {
        const { MockRunner } = await runScript({ collections: 'all' });
        expect(MockRunner.mock.calls[0][0].collections).toEqual(['all']);
    });

    test('collections defaults to an empty array when not supplied', async () => {
        const { MockRunner } = await runScript({});
        expect(MockRunner.mock.calls[0][0].collections).toEqual([]);
    });

    test('batchSize uses the CLI parameter when supplied', async () => {
        const { MockRunner } = await runScript({ batchSize: 20 });
        expect(MockRunner.mock.calls[0][0].batchSize).toBe(20);
    });

    test('batchSize falls back to BULK_BUFFER_SIZE env var when parameter absent', async () => {
        process.env.BULK_BUFFER_SIZE = '888';
        const { MockRunner } = await runScript({});
        expect(MockRunner.mock.calls[0][0].batchSize).toBe('888');
    });

    test('batchSize defaults to 10000 when neither parameter nor env var is set', async () => {
        const { MockRunner } = await runScript({});
        expect(MockRunner.mock.calls[0][0].batchSize).toBe(10000);
    });

    test('useAuditDatabase is coerced to a strict boolean via !!', async () => {
        const on = await runScript({ audit: 'yes' });
        expect(on.MockRunner.mock.calls[0][0].useAuditDatabase).toBe(true);
        const off = await runScript({});
        expect(off.MockRunner.mock.calls[0][0].useAuditDatabase).toBe(false);
    });

    test('forwards mongoDatabaseManager and configManager from the container unchanged', async () => {
        const { MockRunner } = await runScript({});
        expect(MockRunner.mock.calls[0][0].mongoDatabaseManager).toEqual({ marker: 'mongoDatabaseManager' });
        expect(MockRunner.mock.calls[0][0].configManager).toEqual({ marker: 'configManager' });
    });

    test('calls processAsync exactly once and exits with code 0 on success', async () => {
        const { mockProcessAsync, exitSpy } = await runScript({});
        expect(mockProcessAsync).toHaveBeenCalledTimes(1);
        expect(exitSpy).toHaveBeenCalledWith(0);
    });
});
