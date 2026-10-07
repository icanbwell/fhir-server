'use strict';
const { describe, test, expect, beforeEach, afterEach, jest: jestGlobal } = require('@jest/globals');

/**
 * fixDuplicateOwnerTags.js is a thin CLI wrapper: CommandLineParser.parseCommandLine() -> derive
 * a handful of defaulted options -> register+construct FixDuplicateOwnerTagsRunner via the IoC
 * container -> await runner.processAsync() -> exit(0). It has no module.exports and unconditionally
 * self-executes `main()` at require-time (no `require.main === module` guard), so the only way to
 * exercise its real branching (the `collections` "all" default, the batchSize default chain, and
 * the boolean coercions) is to mock every dependency it requires and `require()` the script itself
 * fresh for each argv shape, observing what the real Runner constructor and process.exit were
 * called with.
 */

const SCRIPT_PATH = '../../../../admin/scripts/fixDuplicateOwnerTags';
const RUNNER_PATH = '../../../../admin/runners/fixDuplicateOwnerTagsRunner';
const CLP_PATH = '../../../../admin/scripts/commandLineParser';
const CONTAINER_PATH = '../../../../createContainer';
const LOGGER_PATH = '../../../../admin/adminLogger';

class ProcessExitSignal extends Error {
    constructor (code) {
        super(`process.exit(${code})`);
        this.code = code;
    }
}

// Real Node.js halts synchronous execution the instant process.exit() is called (verified: code
// after a real process.exit() call never runs). A no-op mock would let execution fall through past
// exit() and manufacture fake "bugs" that can never happen outside the test process. Throwing here
// faithfully reproduces the real halt-immediately semantics.
const mockProcessExitImpl = (code) => {
    throw new ProcessExitSignal(code);
};

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
    FixDuplicateOwnerTagsRunner: mockRunnerCtor
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

/**
 * Requires the script fresh (it self-executes `main()` synchronously up to its first await, which
 * is the `await xRunner.processAsync()` line -- everything before that, including the Runner
 * constructor call, has already run by the time `require()` returns). Flushing a couple of ticks
 * lets the awaited `processAsync()` resolve and the subsequent `adminLogger.logInfo`/`process.exit`
 * calls execute.
 * @param {Object} argv what CommandLineParser.parseCommandLine() should return for this run
 */
async function runScript (argv) {
    mockParseCommandLine.mockReturnValue(argv);
    mockCreateContainer.mockReturnValue(buildFakeContainer());
    jestGlobal.isolateModules(() => {
        require(SCRIPT_PATH);
    });
    await flush();
    await flush();
}

describe('fixDuplicateOwnerTags.js (admin script)', () => {
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
        exitSpy = jestGlobal.spyOn(process, 'exit').mockImplementation(mockProcessExitImpl);
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
        expect(mockRunnerCtor).toHaveBeenCalledTimes(1);
        const options = mockRunnerCtor.mock.calls[0][0];
        expect(options.collections).toEqual(['all']);
    });

    test('splits a comma-separated --collections into a trimmed array', async () => {
        await runScript({ collections: 'Patient_4_0_0, Person_4_0_0 ,Practitioner_4_0_0' });
        const options = mockRunnerCtor.mock.calls[0][0];
        expect(options.collections).toEqual(['Patient_4_0_0', 'Person_4_0_0', 'Practitioner_4_0_0']);
    });

    test('defaults batchSize to 1000 when neither --batchSize nor BULK_BUFFER_SIZE is set', async () => {
        const original = process.env.BULK_BUFFER_SIZE;
        delete process.env.BULK_BUFFER_SIZE;
        try {
            await runScript({});
            const options = mockRunnerCtor.mock.calls[0][0];
            expect(options.batchSize).toBe(1000);
        } finally {
            if (original !== undefined) process.env.BULK_BUFFER_SIZE = original;
        }
    });

    test('an explicit --batchSize overrides the default', async () => {
        await runScript({ batchSize: 25000 });
        const options = mockRunnerCtor.mock.calls[0][0];
        expect(options.batchSize).toBe(25000);
    });

    test('coerces useTransaction to a strict boolean via !!', async () => {
        await runScript({ useTransaction: true });
        expect(mockRunnerCtor.mock.calls[0][0].useTransaction).toBe(true);

        mockRunnerCtor.mockClear();
        await runScript({});
        expect(mockRunnerCtor.mock.calls[0][0].useTransaction).toBe(false);
    });

    test('passes startFromCollection, limit, skip and startFromId through untouched', async () => {
        await runScript({ startFromCollection: 'Patient_4_0_0', limit: 10, skip: 5, startFromId: 'abc123' });
        const options = mockRunnerCtor.mock.calls[0][0];
        expect(options.startFromCollection).toBe('Patient_4_0_0');
        expect(options.limit).toBe(10);
        expect(options.skip).toBe(5);
        expect(options.startFromId).toBe('abc123');
    });

    test('wires the real mongoDatabaseManager from the IoC container into the runner', async () => {
        await runScript({});
        const options = mockRunnerCtor.mock.calls[0][0];
        expect(options.mongoDatabaseManager).toEqual({ tag: 'mongoDatabaseManager' });
    });

    test('awaits runner.processAsync() before exiting, and exits 0 on success', async () => {
        await runScript({});
        expect(mockProcessAsync).toHaveBeenCalledTimes(1);
        expect(exitSpy).toHaveBeenCalledWith(0);
    });

    test('does not swallow a rejection from processAsync(): logs it via console.error and never calls process.exit(0)', async () => {
        mockProcessAsync.mockRejectedValueOnce(new Error('mongo down'));
        await runScript({});
        expect(consoleErrorSpy).toHaveBeenCalled();
        expect(exitSpy).not.toHaveBeenCalledWith(0);
    });
});
