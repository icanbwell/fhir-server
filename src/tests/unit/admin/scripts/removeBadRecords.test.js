'use strict';

const { describe, test, expect, afterEach, jest } = require('@jest/globals');
const { SimpleContainer } = require('../../../../utils/simpleContainer');

const SCRIPT_PATH = '../../../../admin/scripts/removeBadRecords';
const RUNNER_PATH = '../../../../admin/runners/removeBadRecordsRunner';
const CONTAINER_PATH = '../../../../createContainer';
const CLI_PARSER_PATH = '../../../../admin/scripts/commandLineParser';

function buildContainer (overrides = {}) {
    const container = new SimpleContainer();
    Object.assign(container, {
        indexManager: { marker: 'indexManager' },
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

    jest.doMock(RUNNER_PATH, () => ({ RemoveBadRecordsRunner: MockRunner }));
    jest.doMock(CONTAINER_PATH, () => ({ createContainer: jest.fn(() => buildContainer()) }));
    jest.doMock(CLI_PARSER_PATH, () => ({ CommandLineParser: { parseCommandLine: () => parameters } }));

    const exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => undefined);
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);

    require(SCRIPT_PATH);
    await flushAsync();

    return { MockRunner, mockProcessAsync, exitSpy, errorSpy };
}

describe('admin/scripts/removeBadRecords.js', () => {
    afterEach(() => {
        jest.restoreAllMocks();
    });

    test('splits comma-separated collections and trims whitespace', async () => {
        const { MockRunner } = await runScript({ collections: 'Patient_4_0_0, Observation_4_0_0 ' });
        expect(MockRunner.mock.calls[0][0].collections).toEqual(['Patient_4_0_0', 'Observation_4_0_0']);
    });

    test('collections="all" becomes the literal single-element array ["all"]', async () => {
        const { MockRunner } = await runScript({ collections: 'all' });
        expect(MockRunner.mock.calls[0][0].collections).toEqual(['all']);
    });

    test('collections defaults to an empty array when not supplied', async () => {
        const { MockRunner } = await runScript({});
        expect(MockRunner.mock.calls[0][0].collections).toEqual([]);
    });

    test('useAuditDatabase is coerced to a strict boolean via !!', async () => {
        const on = await runScript({ audit: true });
        expect(on.MockRunner.mock.calls[0][0].useAuditDatabase).toBe(true);
        const off = await runScript({});
        expect(off.MockRunner.mock.calls[0][0].useAuditDatabase).toBe(false);
    });

    test('includeHistoryCollections is coerced independently of useAuditDatabase', async () => {
        const { MockRunner } = await runScript({ includeHistoryCollections: true, audit: false });
        expect(MockRunner.mock.calls[0][0].includeHistoryCollections).toBe(true);
        expect(MockRunner.mock.calls[0][0].useAuditDatabase).toBe(false);
    });

    test('forwards indexManager and mongoDatabaseManager from the container unchanged', async () => {
        const { MockRunner } = await runScript({});
        expect(MockRunner.mock.calls[0][0].indexManager).toEqual({ marker: 'indexManager' });
        expect(MockRunner.mock.calls[0][0].mongoDatabaseManager).toEqual({ marker: 'mongoDatabaseManager' });
    });

    test('calls processAsync exactly once and exits with code 0 on success', async () => {
        const { mockProcessAsync, exitSpy } = await runScript({});
        expect(mockProcessAsync).toHaveBeenCalledTimes(1);
        expect(exitSpy).toHaveBeenCalledWith(0);
    });
});
