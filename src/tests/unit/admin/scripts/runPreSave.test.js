'use strict';
const { describe, test, expect, beforeEach, afterEach, jest: jestGlobal } = require('@jest/globals');

/**
 * runPreSave.js: thin CLI wrapper around RunPreSaveRunner (extends BaseBulkOperationRunner). Its
 * `collections` derivation has the same shape as fixReferenceSourceAssigningAuthority.js and
 * fixHistory.js:
 *
 *   let collections = parameters.collections ? parameters.collections.split(',')... : [];
 *   if (parameters.collections === 'all') { collections = ['all']; }
 *
 * BaseBulkOperationRunner only expands to "all collections" when `this.collections.length > 0 &&
 * this.collections[0] === 'all'` (src/admin/runners/baseBulkOperationRunner.js:521 /
 * src/admin/runners/runPreSaveRunner.js:135). Omitting `--collections` yields `[]`, which fails
 * that check, so the runner's main loop iterates zero collections. Every other collections-driven
 * script in this batch defaults the omitted case to `['all']`.
 */

const SCRIPT_PATH = '../../../../admin/scripts/runPreSave';
const RUNNER_PATH = '../../../../admin/runners/runPreSaveRunner';
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
    RunPreSaveRunner: mockRunnerCtor
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

describe('runPreSave.js (admin script)', () => {
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
        await runScript({ collections: 'AuditEvent_4_0_0 , AuditEvent_4_0_0_2023_02' });
        expect(mockRunnerCtor.mock.calls[0][0].collections).toEqual(['AuditEvent_4_0_0', 'AuditEvent_4_0_0_2023_02']);
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

    test('coerces useAuditDatabase from --audit with !!', async () => {
        await runScript({ collections: 'all', audit: true });
        expect(mockRunnerCtor.mock.calls[0][0].useAuditDatabase).toBe(true);

        mockRunnerCtor.mockClear();
        await runScript({ collections: 'all' });
        expect(mockRunnerCtor.mock.calls[0][0].useAuditDatabase).toBe(false);
    });

    test('coerces includeHistoryCollections with !!', async () => {
        await runScript({ collections: 'all', includeHistoryCollections: true });
        expect(mockRunnerCtor.mock.calls[0][0].includeHistoryCollections).toBe(true);
    });

    test('parses --after and --before into Date objects', async () => {
        await runScript({ collections: 'all', after: '2021-01-01', before: '2021-12-31' });
        const options = mockRunnerCtor.mock.calls[0][0];
        expect(options.afterLastUpdatedDate).toBeInstanceOf(Date);
        expect(options.beforeLastUpdatedDate).toBeInstanceOf(Date);
    });

    test('awaits runner.processAsync() then exits 0 on success', async () => {
        await runScript({ collections: 'all' });
        expect(mockProcessAsync).toHaveBeenCalledTimes(1);
        expect(exitSpy).toHaveBeenCalledWith(0);
    });
});
