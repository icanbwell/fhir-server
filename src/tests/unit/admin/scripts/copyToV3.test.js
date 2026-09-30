'use strict';
const { describe, test, expect, beforeEach, afterEach, jest: jestGlobal } = require('@jest/globals');

/**
 * copyToV3.js: thin CLI wrapper around CopyToV3Runner. Validates a required `--updatedAfter`
 * argument before constructing the runner:
 *
 *   if (!parameters.updatedAfter) {
 *       adminLogger.logInfo('UpdatedAfter is a required field.');
 *       process.exit(0);
 *   }
 *
 * Every other required-argument check in this batch (see changeSourceAssigningAuthority.js)
 * signals failure with a thrown Error, which propagates to the top-level `main().catch(...)` and
 * is visible as a non-zero-ish failure path. This script instead calls `process.exit(0)` -- exit
 * code 0 conventionally means "success". A caller that scripts this migration (cron, CI step,
 * shell `&&` chain) and only checks the exit code will see "0" and conclude the migration ran,
 * when in fact nothing happened because a required argument was missing.
 */

const SCRIPT_PATH = '../../../../admin/scripts/copyToV3';
const RUNNER_PATH = '../../../../admin/runners/copyToV3Runner.js';
const CLP_PATH = '../../../../admin/scripts/commandLineParser';
const CONTAINER_PATH = '../../../../createContainer';
const LOGGER_PATH = '../../../../admin/adminLogger';
const LOGGING_PATH = '../../../../operations/common/logging';
const moment = require('moment-timezone');

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

jestGlobal.mock(LOGGING_PATH, () => ({
    logInfo: jestGlobal.fn(),
    logError: jestGlobal.fn(),
    logWarn: jestGlobal.fn()
}));

const mockProcessAsync = jestGlobal.fn().mockResolvedValue(undefined);
const mockRunnerCtor = jestGlobal.fn().mockImplementation(function (options) {
    this.options = options;
    this.processAsync = mockProcessAsync;
});
jestGlobal.mock(RUNNER_PATH, () => ({
    CopyToV3Runner: mockRunnerCtor
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

describe('copyToV3.js (admin script)', () => {
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

    test('constructs CopyToV3Runner with the parsed updatedAfter as a moment object when provided', async () => {
        await runScript({ updatedAfter: '2023-04-20' });
        expect(mockRunnerCtor).toHaveBeenCalledTimes(1);
        const options = mockRunnerCtor.mock.calls[0][0];
        expect(options.updatedAfter.toISOString()).toBe(moment('2023-04-20').toISOString());
    });

    test('defaults batchSize to 10000 and concurrentRunners to 1', async () => {
        const original = process.env.BULK_BUFFER_SIZE;
        delete process.env.BULK_BUFFER_SIZE;
        try {
            await runScript({ updatedAfter: '2023-04-20' });
            const options = mockRunnerCtor.mock.calls[0][0];
            expect(options.batchSize).toBe(10000);
            expect(options.concurrentRunners).toBe(1);
        } finally {
            if (original !== undefined) process.env.BULK_BUFFER_SIZE = original;
        }
    });

    test('explicit --batchSize and --concurrentRunners override the defaults', async () => {
        await runScript({ updatedAfter: '2023-04-20', batchSize: 500, concurrentRunners: 5 });
        const options = mockRunnerCtor.mock.calls[0][0];
        expect(options.batchSize).toBe(500);
        expect(options.concurrentRunners).toBe(5);
    });

    test('coerces _idAbove to a string when provided, leaves it undefined otherwise', async () => {
        await runScript({ updatedAfter: '2023-04-20', _idAbove: 12345 });
        expect(mockRunnerCtor.mock.calls[0][0]._idAbove).toBe('12345');

        mockRunnerCtor.mockClear();
        await runScript({ updatedAfter: '2023-04-20' });
        expect(mockRunnerCtor.mock.calls[0][0]._idAbove).toBeUndefined();
    });

    test('splits --collections on comma, and leaves collections undefined when omitted (no "all" expansion)', async () => {
        await runScript({ updatedAfter: '2023-04-20', collections: 'Task_4_0_0,Patient_4_0_0' });
        expect(mockRunnerCtor.mock.calls[0][0].collections).toEqual(['Task_4_0_0', 'Patient_4_0_0']);

        mockRunnerCtor.mockClear();
        await runScript({ updatedAfter: '2023-04-20' });
        expect(mockRunnerCtor.mock.calls[0][0].collections).toBeUndefined();
    });

    test('coerces skipHistoryCollections with !!', async () => {
        await runScript({ updatedAfter: '2023-04-20', skipHistoryCollections: true });
        expect(mockRunnerCtor.mock.calls[0][0].skipHistoryCollections).toBe(true);
    });

    test('awaits runner.processAsync() then exits 0 on success', async () => {
        await runScript({ updatedAfter: '2023-04-20' });
        expect(mockProcessAsync).toHaveBeenCalledTimes(1);
        expect(exitSpy).toHaveBeenCalledWith(0);
    });
});
