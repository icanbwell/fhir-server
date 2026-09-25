'use strict';
const { describe, test, expect, beforeEach, afterEach, jest: jestGlobal } = require('@jest/globals');

/**
 * fixPersonLinks.js: thin CLI wrapper around FixPersonLinksRunner. Always targets Person_4_0_0
 * (no --collections option at all); the only list-shaped option is --preLoadCollections.
 */

const SCRIPT_PATH = '../../../../admin/scripts/fixPersonLinks';
const RUNNER_PATH = '../../../../admin/runners/fixPersonLinksRunner';
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
    FixPersonLinksRunner: mockRunnerCtor
}));

const mockCreateContainer = jestGlobal.fn();
jestGlobal.mock(CONTAINER_PATH, () => ({
    createContainer: mockCreateContainer
}));

function buildFakeContainer () {
    const fakeContainer = {
        mongoDatabaseManager: { tag: 'mongoDatabaseManager' },
        resourceLocatorFactory: { tag: 'resourceLocatorFactory' },
        preSaveManager: { tag: 'preSaveManager' },
        databaseQueryFactory: { tag: 'databaseQueryFactory' }
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

describe('fixPersonLinks.js (admin script)', () => {
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

    test('defaults batchSize to 10000 when neither --batchSize nor BULK_BUFFER_SIZE is set', async () => {
        const original = process.env.BULK_BUFFER_SIZE;
        delete process.env.BULK_BUFFER_SIZE;
        try {
            await runScript({});
            expect(mockRunnerCtor.mock.calls[0][0].batchSize).toBe(10000);
        } finally {
            if (original !== undefined) process.env.BULK_BUFFER_SIZE = original;
        }
    });

    test('an explicit --batchSize overrides the default', async () => {
        await runScript({ batchSize: 250 });
        expect(mockRunnerCtor.mock.calls[0][0].batchSize).toBe(250);
    });

    test('parses --before into a Date; there is no --after support for this script', async () => {
        await runScript({ before: '2023-10-28' });
        const options = mockRunnerCtor.mock.calls[0][0];
        expect(options.beforeLastUpdatedDate).toBeInstanceOf(Date);
        expect(options.beforeLastUpdatedDate.toISOString()).toBe(new Date('2023-10-28').toISOString());
    });

    test('defaults preLoadCollections to [] and splits/trims when provided', async () => {
        await runScript({});
        expect(mockRunnerCtor.mock.calls[0][0].preloadCollections).toEqual([]);

        mockRunnerCtor.mockClear();
        await runScript({ preLoadCollections: 'Person_4_0_0 , Patient_4_0_0' });
        expect(mockRunnerCtor.mock.calls[0][0].preloadCollections).toEqual(['Person_4_0_0', 'Patient_4_0_0']);
    });

    test('passes limit, skip and minLinks through untouched', async () => {
        await runScript({ limit: 5, skip: 10, minLinks: 20 });
        const options = mockRunnerCtor.mock.calls[0][0];
        expect(options.limit).toBe(5);
        expect(options.skip).toBe(10);
        expect(options.minLinks).toBe(20);
    });

    test('awaits runner.processAsync() then exits 0 on success', async () => {
        await runScript({});
        expect(mockProcessAsync).toHaveBeenCalledTimes(1);
        expect(exitSpy).toHaveBeenCalledWith(0);
    });
});
