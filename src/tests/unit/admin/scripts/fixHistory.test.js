'use strict';
const { describe, test, expect, beforeEach, afterEach, jest: jestGlobal } = require('@jest/globals');

/**
 * fixHistory.js: thin CLI wrapper around FixHistoryRunner (extends BaseBulkOperationRunner). Same
 * `collections` derivation shape as runPreSave.js and fixReferenceSourceAssigningAuthority.js:
 *
 *   let collections = parameters.collections ? parameters.collections.split(',')... : [];
 *   if (parameters.collections === 'all') { collections = ['all']; }
 *
 * BaseBulkOperationRunner only expands to "all collections" when `this.collections.length > 0 &&
 * this.collections[0] === 'all'` (src/admin/runners/baseBulkOperationRunner.js:521 /
 * src/admin/runners/fixHistoryRunner.js:102). Omitting `--collections` yields `[]`, which fails
 * that check, so the runner's main loop iterates zero collections.
 */

const SCRIPT_PATH = '../../../../admin/scripts/fixHistory';
const RUNNER_PATH = '../../../../admin/runners/fixHistoryRunner';
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
    FixHistoryRunner: mockRunnerCtor
}));

const mockCreateContainer = jestGlobal.fn();
jestGlobal.mock(CONTAINER_PATH, () => ({
    createContainer: mockCreateContainer
}));

function buildFakeContainer () {
    const fakeContainer = {
        mongoDatabaseManager: { tag: 'mongoDatabaseManager' },
        preSaveManager: { tag: 'preSaveManager' }
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

describe('fixHistory.js (admin script)', () => {
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

    test('an explicit --collections=all is honoured', async () => {
        await runScript({ collections: 'all' });
        expect(mockRunnerCtor.mock.calls[0][0].collections).toEqual(['all']);
    });

    test('splits and trims an explicit comma-separated --collections', async () => {
        await runScript({ collections: 'Practitioner_4_0_0_History , Account_4_0_0_History' });
        expect(mockRunnerCtor.mock.calls[0][0].collections).toEqual([
            'Practitioner_4_0_0_History',
            'Account_4_0_0_History'
        ]);
    });

    test('defaults batchSize to 10000 when neither --batchSize nor BULK_BUFFER_SIZE is set', async () => {
        const original = process.env.BULK_BUFFER_SIZE;
        delete process.env.BULK_BUFFER_SIZE;
        try {
            await runScript({ collections: 'all' });
            expect(mockRunnerCtor.mock.calls[0][0].batchSize).toBe(10000);
        } finally {
            if (original !== undefined) process.env.BULK_BUFFER_SIZE = original;
        }
    });

    test('passes startFromCollection and skipIfResourcePresent through untouched', async () => {
        await runScript({ collections: 'all', startFromCollection: 'Practitioner_4_0_0', skipIfResourcePresent: true });
        const options = mockRunnerCtor.mock.calls[0][0];
        expect(options.startFromCollection).toBe('Practitioner_4_0_0');
        expect(options.skipIfResourcePresent).toBe(true);
    });

    test('wires the real mongoDatabaseManager and preSaveManager from the IoC container', async () => {
        await runScript({ collections: 'all' });
        const options = mockRunnerCtor.mock.calls[0][0];
        expect(options.mongoDatabaseManager).toEqual({ tag: 'mongoDatabaseManager' });
        expect(options.preSaveManager).toEqual({ tag: 'preSaveManager' });
    });

    test('awaits runner.processAsync() then exits 0 on success', async () => {
        await runScript({ collections: 'all' });
        expect(mockProcessAsync).toHaveBeenCalledTimes(1);
        expect(exitSpy).toHaveBeenCalledWith(0);
    });
});
