'use strict';
const { describe, test, expect, beforeEach, afterEach, jest: jestGlobal } = require('@jest/globals');

/**
 * fixInstantDataType.js is a thin CLI wrapper with the same shape as fixDuplicateOwnerTags.js:
 * parse argv -> derive defaulted options -> register+construct FixInstantDataTypeRunner via the
 * IoC container -> await runner.processAsync() -> exit(0). No module.exports; self-executes on
 * require. Tested by mocking every dependency and requiring the script fresh per argv shape.
 */

const SCRIPT_PATH = '../../../../admin/scripts/fixInstantDataType';
const RUNNER_PATH = '../../../../admin/runners/fixInstantDataTypeRunner';
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
    FixInstantDataTypeRunner: mockRunnerCtor
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

describe('fixInstantDataType.js (admin script)', () => {
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

    test('defaults collections to ["all"] when --collections is omitted', async () => {
        await runScript({});
        const options = mockRunnerCtor.mock.calls[0][0];
        expect(options.collections).toEqual(['all']);
    });

    test('splits and trims a comma-separated --collections', async () => {
        await runScript({ collections: 'Patient_4_0_0 , Observation_4_0_0' });
        const options = mockRunnerCtor.mock.calls[0][0];
        expect(options.collections).toEqual(['Patient_4_0_0', 'Observation_4_0_0']);
    });

    test('defaults batchSize to 1000 when neither --batchSize nor BULK_BUFFER_SIZE is set', async () => {
        const original = process.env.BULK_BUFFER_SIZE;
        delete process.env.BULK_BUFFER_SIZE;
        try {
            await runScript({});
            expect(mockRunnerCtor.mock.calls[0][0].batchSize).toBe(1000);
        } finally {
            if (original !== undefined) process.env.BULK_BUFFER_SIZE = original;
        }
    });

    test('an explicit --batchSize overrides the default', async () => {
        await runScript({ batchSize: 500 });
        expect(mockRunnerCtor.mock.calls[0][0].batchSize).toBe(500);
    });

    test('coerces useTransaction with !! (undefined -> false, truthy -> true)', async () => {
        await runScript({});
        expect(mockRunnerCtor.mock.calls[0][0].useTransaction).toBe(false);

        mockRunnerCtor.mockClear();
        await runScript({ useTransaction: 'yes' });
        expect(mockRunnerCtor.mock.calls[0][0].useTransaction).toBe(true);
    });

    test('passes startFromCollection, limit, skip and startFromId through untouched', async () => {
        await runScript({ startFromCollection: 'Observation_4_0_0', limit: 3, skip: 7, startFromId: 'xyz' });
        const options = mockRunnerCtor.mock.calls[0][0];
        expect(options.startFromCollection).toBe('Observation_4_0_0');
        expect(options.limit).toBe(3);
        expect(options.skip).toBe(7);
        expect(options.startFromId).toBe('xyz');
    });

    test('awaits runner.processAsync() then exits 0 on success', async () => {
        await runScript({});
        expect(mockProcessAsync).toHaveBeenCalledTimes(1);
        expect(exitSpy).toHaveBeenCalledWith(0);
    });
});
