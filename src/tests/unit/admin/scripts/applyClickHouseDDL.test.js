'use strict';

const { describe, test, expect, afterEach, jest } = require('@jest/globals');
const { SimpleContainer } = require('../../../../utils/simpleContainer');

/**
 * src/admin/scripts/applyClickHouseDDL.js has real control flow beyond argument derivation: it
 * runs the runner inside a try/finally that always closes the ClickHouse client (even on
 * failure), and its own main().catch calls process.exit(1) -- unlike most sibling scripts, which
 * just log the rejection. Both behaviors are exercised here.
 */

const SCRIPT_PATH = '../../../../admin/scripts/applyClickHouseDDL';
const RUNNER_PATH = '../../../../admin/runners/applyClickHouseDDLRunner';
const CONTAINER_PATH = '../../../../createContainer';
const CLI_PARSER_PATH = '../../../../admin/scripts/commandLineParser';

function buildContainer (overrides = {}) {
    const container = new SimpleContainer();
    Object.assign(container, {
        mongoDatabaseManager: { marker: 'mongoDatabaseManager' },
        clickHouseClientManager: { marker: 'clickHouseClientManager', closeAsync: jest.fn().mockResolvedValue(undefined) }
    }, overrides);
    return container;
}

async function flushAsync (times = 15) {
    for (let i = 0; i < times; i++) {
        await Promise.resolve();
    }
}

async function runScript (parameters, { processAsyncImpl, containerOverrides } = {}) {
    jest.resetModules();

    const mockProcessAsync = processAsyncImpl || jest.fn().mockResolvedValue(undefined);
    const MockRunner = jest.fn().mockImplementation(function (args) {
        this.constructorArgs = args;
        this.processAsync = mockProcessAsync;
    });

    const container = buildContainer(containerOverrides);

    jest.doMock(RUNNER_PATH, () => ({ ApplyClickHouseDDLRunner: MockRunner }));
    jest.doMock(CONTAINER_PATH, () => ({ createContainer: jest.fn(() => container) }));
    jest.doMock(CLI_PARSER_PATH, () => ({ CommandLineParser: { parseCommandLine: () => parameters } }));

    const exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => undefined);
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);

    require(SCRIPT_PATH);
    await flushAsync();

    return { MockRunner, mockProcessAsync, exitSpy, errorSpy, container };
}

describe('admin/scripts/applyClickHouseDDL.js', () => {
    afterEach(() => {
        jest.restoreAllMocks();
    });

    test('dir defaults to "clickhouse-init" when not supplied', async () => {
        const { MockRunner } = await runScript({});
        expect(MockRunner.mock.calls[0][0].dir).toBe('clickhouse-init');
    });

    test('a caller-supplied --dir overrides the default', async () => {
        const { MockRunner } = await runScript({ dir: 'custom-dir' });
        expect(MockRunner.mock.calls[0][0].dir).toBe('custom-dir');
    });

    test('--file is forwarded as-is (no default)', async () => {
        const { MockRunner } = await runScript({ file: 'clickhouse-init/02-audit-event.sql' });
        expect(MockRunner.mock.calls[0][0].file).toBe('clickhouse-init/02-audit-event.sql');
    });

    test('dryRun is coerced with Boolean() rather than left as the raw parameter', async () => {
        const on = await runScript({ dryRun: 'anything-truthy' });
        expect(on.MockRunner.mock.calls[0][0].dryRun).toBe(true);
        const off = await runScript({});
        expect(off.MockRunner.mock.calls[0][0].dryRun).toBe(false);
    });

    test('skipDatabaseCreation is coerced with Boolean()', async () => {
        const { MockRunner } = await runScript({ skipDatabaseCreation: 1 });
        expect(MockRunner.mock.calls[0][0].skipDatabaseCreation).toBe(true);
    });

    test('closes the ClickHouse client after a successful run and exits 0', async () => {
        const { container, exitSpy } = await runScript({});
        expect(container.clickHouseClientManager.closeAsync).toHaveBeenCalledTimes(1);
        expect(exitSpy).toHaveBeenCalledWith(0);
    });

    test('BUG-CANDIDATE-CHECK: still closes the ClickHouse client when processAsync rejects (finally semantics)', async () => {
        const failingProcessAsync = jest.fn().mockRejectedValue(new Error('DDL failed'));
        const { container, exitSpy, errorSpy } = await runScript({}, { processAsyncImpl: failingProcessAsync });
        expect(container.clickHouseClientManager.closeAsync).toHaveBeenCalledTimes(1);
        // main().catch logs the rejection and exits 1 -- exit(0) inside main() must not have run.
        expect(exitSpy).toHaveBeenCalledWith(1);
        expect(exitSpy).not.toHaveBeenCalledWith(0);
        expect(errorSpy).toHaveBeenCalled();
    });

    test('does not attempt to close a clickHouseClientManager the container never provided', async () => {
        const { exitSpy } = await runScript({}, { containerOverrides: { clickHouseClientManager: undefined } });
        // no throw means the falsy-guard around container.clickHouseClientManager held
        expect(exitSpy).toHaveBeenCalledWith(0);
    });

    test('forwards mongoDatabaseManager from the container unchanged', async () => {
        const { MockRunner } = await runScript({});
        expect(MockRunner.mock.calls[0][0].mongoDatabaseManager).toEqual({ marker: 'mongoDatabaseManager' });
    });

    test('calls processAsync exactly once on a normal run', async () => {
        const { mockProcessAsync } = await runScript({});
        expect(mockProcessAsync).toHaveBeenCalledTimes(1);
    });
});
