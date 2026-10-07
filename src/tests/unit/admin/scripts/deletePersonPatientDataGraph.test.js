'use strict';
const { describe, test, expect, beforeEach, afterEach, jest: jestGlobal } = require('@jest/globals');

/**
 * deletePersonPatientDataGraph.js: thin CLI wrapper around DeletePersonPatientDataGraphRunner.
 * Its most important piece of branching is the `dryRun` default:
 *
 *   const dryRun = parameters.dryRun ? Boolean(parameters.dryRun === 'true') : true;
 *
 * i.e. this destructive script (it deletes a Person/Patient's entire data graph) defaults to
 * DRY RUN unless the operator explicitly passes `--dryRun true`... but note `--dryRun false`
 * (a non-empty *string* "false") is truthy, so `Boolean('false' === 'true')` correctly evaluates
 * to `false` and really does disable dry-run. That subtlety is exercised explicitly below.
 */

const SCRIPT_PATH = '../../../../admin/scripts/deletePersonPatientDataGraph';
const RUNNER_PATH = '../../../../admin/runners/deletePersonPatientDataGraphRunner';
const CLP_PATH = '../../../../admin/scripts/commandLineParser';
const CONTAINER_PATH = '../../../../createContainer';
const LOGGER_PATH = '../../../../admin/adminLogger';

class ProcessExitSignal extends Error {
    constructor (code) {
        super(`process.exit(${code})`);
        this.code = code;
    }
}

const mockParseCommandLine = jestGlobal.fn();
jestGlobal.mock(CLP_PATH, () => ({
    CommandLineParser: { parseCommandLine: mockParseCommandLine }
}));

const mockAdminLoggerCtor = jestGlobal.fn().mockImplementation(() => ({
    logInfo: jestGlobal.fn(),
    logError: jestGlobal.fn(),
    logWarn: jestGlobal.fn()
}));
jestGlobal.mock(LOGGER_PATH, () => ({
    AdminLogger: mockAdminLoggerCtor
}));

const mockProcessAsync = jestGlobal.fn().mockResolvedValue(undefined);
const mockRunnerCtor = jestGlobal.fn().mockImplementation(function (options) {
    this.options = options;
    this.processAsync = mockProcessAsync;
});
jestGlobal.mock(RUNNER_PATH, () => ({
    DeletePersonPatientDataGraphRunner: mockRunnerCtor
}));

const mockCreateContainer = jestGlobal.fn();
jestGlobal.mock(CONTAINER_PATH, () => ({
    createContainer: mockCreateContainer
}));

function buildFakeContainer () {
    const fakeContainer = {
        mongoDatabaseManager: { tag: 'mongoDatabaseManager' },
        adminPersonPatientDataManager: { tag: 'adminPersonPatientDataManager' }
    };
    fakeContainer.register = jestGlobal.fn((name, factory) => {
        Object.defineProperty(fakeContainer, name, {
            get: () => factory(fakeContainer),
            configurable: true
        });
    });
    return fakeContainer;
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

async function runScript (argv) {
    mockParseCommandLine.mockReturnValue(argv);
    mockCreateContainer.mockReturnValue(buildFakeContainer());
    jestGlobal.isolateModules(() => {
        require(SCRIPT_PATH);
    });
    await flush();
    await flush();
}

describe('deletePersonPatientDataGraph.js (admin script)', () => {
    let exitSpy;
    let consoleLogSpy;
    let consoleErrorSpy;

    beforeEach(() => {
        jestGlobal.resetModules();
        mockParseCommandLine.mockReset();
        mockRunnerCtor.mockClear();
        mockProcessAsync.mockClear().mockResolvedValue(undefined);
        mockAdminLoggerCtor.mockClear();
        mockCreateContainer.mockReset();
        exitSpy = jestGlobal.spyOn(process, 'exit').mockImplementation((code) => {
            throw new ProcessExitSignal(code);
        });
        consoleLogSpy = jestGlobal.spyOn(console, 'log').mockImplementation(() => {});
        consoleErrorSpy = jestGlobal.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
        exitSpy.mockRestore();
        consoleLogSpy.mockRestore();
        consoleErrorSpy.mockRestore();
    });

    test('defaults dryRun to true (safe-by-default) when --dryRun is omitted', async () => {
        await runScript({ patientUuids: 'uuid-1' });
        expect(mockRunnerCtor.mock.calls[0][0].dryRun).toBe(true);
    });

    test('--dryRun true keeps dry-run enabled', async () => {
        await runScript({ patientUuids: 'uuid-1', dryRun: 'true' });
        expect(mockRunnerCtor.mock.calls[0][0].dryRun).toBe(true);
    });

    test('--dryRun false (string) really disables dry-run', async () => {
        await runScript({ patientUuids: 'uuid-1', dryRun: 'false' });
        expect(mockRunnerCtor.mock.calls[0][0].dryRun).toBe(false);
    });

    test('splits comma-separated patientUuids and personUuids (no trimming, no default)', async () => {
        await runScript({ patientUuids: 'uuid-1,uuid-2', personUuids: 'uuid-3' });
        const options = mockRunnerCtor.mock.calls[0][0];
        expect(options.patientUuids).toEqual(['uuid-1', 'uuid-2']);
        expect(options.personUuids).toEqual(['uuid-3']);

        mockRunnerCtor.mockClear();
        await runScript({});
        const options2 = mockRunnerCtor.mock.calls[0][0];
        expect(options2.patientUuids).toEqual([]);
        expect(options2.personUuids).toEqual([]);
    });

    test('defaults batchSize to 10000 and concurrencyBatchSize to 10', async () => {
        const original = process.env.BULK_BUFFER_SIZE;
        delete process.env.BULK_BUFFER_SIZE;
        try {
            await runScript({});
            const options = mockRunnerCtor.mock.calls[0][0];
            expect(options.batchSize).toBe(10000);
            expect(options.concurrencyBatchSize).toBe(10);
        } finally {
            if (original !== undefined) process.env.BULK_BUFFER_SIZE = original;
        }
    });

    test('splits and trims --properties', async () => {
        await runScript({ properties: 'link , identifier' });
        expect(mockRunnerCtor.mock.calls[0][0].properties).toEqual(['link', 'identifier']);
    });

    test('wires adminPersonPatientDataManager from the IoC container', async () => {
        await runScript({});
        expect(mockRunnerCtor.mock.calls[0][0].adminPersonPatientDataManager).toEqual({
            tag: 'adminPersonPatientDataManager'
        });
    });

    test('awaits runner.processAsync() then exits 0 on success', async () => {
        await runScript({ patientUuids: 'uuid-1' });
        expect(mockProcessAsync).toHaveBeenCalledTimes(1);
        expect(exitSpy).toHaveBeenCalledWith(0);
    });
});
