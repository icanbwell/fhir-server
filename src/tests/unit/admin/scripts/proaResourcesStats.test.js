'use strict';
const { describe, test, expect, beforeEach, afterEach, jest: jestGlobal } = require('@jest/globals');

/**
 * proaResourcesStats.js: thin CLI wrapper around ProaResourcesStats. Notably its --collections
 * parsing is `parameters.collections.split(',')` with NO `.map(x => x.trim())` -- every other
 * comma-separated-list option in this batch (collections/properties/preLoadCollections/
 * filterToRecordsWithFields elsewhere) trims each entry. A value like
 * `--collections="A_4_0_0, B_4_0_0"` (space after the comma) therefore yields `["A_4_0_0",
 * " B_4_0_0"]` with a leading space that will never match a real collection name.
 */

const SCRIPT_PATH = '../../../../admin/scripts/proaResourcesStats';
const RUNNER_PATH = '../../../../admin/runners/proaResourcesStatsRunner';
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
    ProaResourcesStats: mockRunnerCtor
}));

const mockCreateContainer = jestGlobal.fn();
jestGlobal.mock(CONTAINER_PATH, () => ({
    createContainer: mockCreateContainer
}));

function buildFakeContainer () {
    const fakeContainer = {
        mongoDatabaseManager: { tag: 'mongoDatabaseManager' }
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

describe('proaResourcesStats.js (admin script)', () => {
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

    test('defaults collections to the built-in PROA resource list when --collections is omitted', async () => {
        await runScript({});
        const options = mockRunnerCtor.mock.calls[0][0];
        expect(Array.isArray(options.collections)).toBe(true);
        expect(options.collections.length).toBeGreaterThan(20);
        expect(options.collections).toContain('Patient_4_0_0');
        expect(options.collections).toContain('Observation_4_0_0');
    });

    test('an explicit --collections replaces the default list entirely', async () => {
        await runScript({ collections: 'AllergyIntolerance_4_0_0,Patient_4_0_0' });
        expect(mockRunnerCtor.mock.calls[0][0].collections).toEqual(['AllergyIntolerance_4_0_0', 'Patient_4_0_0']);
    });

    test('--collections entries are NOT trimmed, unlike every other comma-list option in this batch', async () => {
        await runScript({ collections: 'AllergyIntolerance_4_0_0, Patient_4_0_0' });
        // Correct/consistent behavior (matching fixDuplicateUuid, fixCodeableConcepts, etc.):
        // whitespace around each entry should be trimmed so "A, B" behaves the same as "A,B".
        expect(mockRunnerCtor.mock.calls[0][0].collections).toEqual(['AllergyIntolerance_4_0_0', 'Patient_4_0_0']);
    });

    test('wires the real mongoDatabaseManager from the IoC container into the runner', async () => {
        await runScript({});
        expect(mockRunnerCtor.mock.calls[0][0].mongoDatabaseManager).toEqual({ tag: 'mongoDatabaseManager' });
    });

    test('awaits runner.processAsync() then exits 0 on success', async () => {
        await runScript({});
        expect(mockProcessAsync).toHaveBeenCalledTimes(1);
        expect(exitSpy).toHaveBeenCalledWith(0);
    });

    test('does not swallow a rejection from processAsync(): logs it via console.error and never calls process.exit(0)', async () => {
        mockProcessAsync.mockRejectedValueOnce(new Error('boom'));
        await runScript({});
        expect(consoleErrorSpy).toHaveBeenCalled();
        expect(exitSpy).not.toHaveBeenCalledWith(0);
    });
});
