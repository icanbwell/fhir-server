'use strict';

const { describe, test, expect, afterEach, jest } = require('@jest/globals');
const { SimpleContainer } = require('../../../../utils/simpleContainer');

/**
 * src/admin/scripts/partitionAuditEvent.js derives recordedAfter/recordedBefore date bounds (with
 * hardcoded fallback dates), a batchSize fallback chain (param -> env -> default), several
 * !!-coercions and a sourceCollection default, then wires PartitionAuditEventRunner.
 */

const SCRIPT_PATH = '../../../../admin/scripts/partitionAuditEvent';
const RUNNER_PATH = '../../../../admin/runners/partitionAuditEventRunner';
const CONTAINER_PATH = '../../../../createContainer';
const CLI_PARSER_PATH = '../../../../admin/scripts/commandLineParser';

function buildContainer (overrides = {}) {
    const container = new SimpleContainer();
    Object.assign(container, {
        mongoDatabaseManager: { marker: 'mongoDatabaseManager' },
        indexManager: { marker: 'indexManager' }
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

    jest.doMock(RUNNER_PATH, () => ({ PartitionAuditEventRunner: MockRunner }));
    jest.doMock(CONTAINER_PATH, () => ({ createContainer: jest.fn(() => buildContainer()) }));
    jest.doMock(CLI_PARSER_PATH, () => ({ CommandLineParser: { parseCommandLine: () => parameters } }));

    const exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => undefined);
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);

    require(SCRIPT_PATH);
    await flushAsync();

    return { MockRunner, mockProcessAsync, exitSpy, logSpy, errorSpy };
}

describe('admin/scripts/partitionAuditEvent.js', () => {
    afterEach(() => {
        jest.restoreAllMocks();
        delete process.env.BULK_BUFFER_SIZE;
    });

    test('defaults recordedAfter to 2021-06-01 when --from is not supplied', async () => {
        const { MockRunner } = await runScript({});
        expect(MockRunner.mock.calls[0][0].recordedAfter.toDate().getTime())
            .toBe(new Date(2021, 5, 1).getTime());
    });

    test('defaults recordedBefore to 2022-10-01 when --to is not supplied', async () => {
        const { MockRunner } = await runScript({});
        expect(MockRunner.mock.calls[0][0].recordedBefore.toDate().getTime())
            .toBe(new Date(2022, 9, 1).getTime());
    });

    test('parses a caller-supplied --from as UTC midnight of that date', async () => {
        const { MockRunner } = await runScript({ from: '2023-01-15' });
        expect(MockRunner.mock.calls[0][0].recordedAfter.toISOString())
            .toBe(new Date('2023-01-15T00:00:00Z').toISOString());
    });

    test('parses a caller-supplied --to as UTC midnight of that date', async () => {
        const { MockRunner } = await runScript({ to: '2023-02-20' });
        expect(MockRunner.mock.calls[0][0].recordedBefore.toISOString())
            .toBe(new Date('2023-02-20T00:00:00Z').toISOString());
    });

    test('batchSize uses the CLI parameter when supplied', async () => {
        const { MockRunner } = await runScript({ batchSize: 42 });
        expect(MockRunner.mock.calls[0][0].batchSize).toBe(42);
    });

    test('batchSize falls back to BULK_BUFFER_SIZE env var when parameter absent', async () => {
        process.env.BULK_BUFFER_SIZE = '999';
        const { MockRunner } = await runScript({});
        expect(MockRunner.mock.calls[0][0].batchSize).toBe('999');
    });

    test('batchSize defaults to 10000 when neither parameter nor env var is set', async () => {
        const { MockRunner } = await runScript({});
        expect(MockRunner.mock.calls[0][0].batchSize).toBe(10000);
    });

    test('skipExistingIds and useAuditDatabase are independent !!-coercions', async () => {
        const { MockRunner } = await runScript({ skipExistingIds: true, audit: false });
        expect(MockRunner.mock.calls[0][0].skipExistingIds).toBe(true);
        expect(MockRunner.mock.calls[0][0].useAuditDatabase).toBe(false);
    });

    test('dropDestinationCollection is coerced to boolean via !!', async () => {
        const { MockRunner } = await runScript({ dropDestinationCollection: 1 });
        expect(MockRunner.mock.calls[0][0].dropDestinationCollection).toBe(true);
    });

    test('sourceCollection defaults to AuditEvent_4_0_0 when not supplied', async () => {
        const { MockRunner } = await runScript({});
        expect(MockRunner.mock.calls[0][0].sourceCollection).toBe('AuditEvent_4_0_0');
    });

    test('sourceCollection uses the CLI parameter when supplied', async () => {
        const { MockRunner } = await runScript({ source: 'backup_AuditEvent_4_0_0' });
        expect(MockRunner.mock.calls[0][0].sourceCollection).toBe('backup_AuditEvent_4_0_0');
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
