'use strict';
const { describe, test, expect, beforeEach, afterEach, jest: jestGlobal } = require('@jest/globals');

/**
 * changeSourceAssigningAuthority.js: thin CLI wrapper around ChangeSourceAssigningAuthorityRunner.
 * Unlike every other script in this batch, it validates two REQUIRED parameters
 * (oldSourceAssigningAuthority, newSourceAssigningAuthority) by throwing a plain Error -- there is
 * no `process.exit()` short-circuit here, so the failure propagates to `main().catch(...)` as a
 * normal rejected promise.
 */

const SCRIPT_PATH = '../../../../admin/scripts/changeSourceAssigningAuthority';
const RUNNER_PATH = '../../../../admin/runners/changeSourceAssigningAuthorityRunner';
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
    ChangeSourceAssigningAuthorityRunner: mockRunnerCtor
}));

const mockCreateContainer = jestGlobal.fn();
jestGlobal.mock(CONTAINER_PATH, () => ({
    createContainer: mockCreateContainer
}));

function buildFakeContainer () {
    const fakeContainer = {
        mongoDatabaseManager: { tag: 'mongoDatabaseManager' },
        preSaveManager: { tag: 'preSaveManager' },
        databaseQueryFactory: { tag: 'databaseQueryFactory' },
        resourceLocatorFactory: { tag: 'resourceLocatorFactory' },
        resourceMerger: { tag: 'resourceMerger' },
        searchParametersManager: { tag: 'searchParametersManager' }
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

const VALID_ARGV = { oldSourceAssigningAuthority: 'client', newSourceAssigningAuthority: 'new_client' };

async function runScript (argv) {
    mockParseCommandLine.mockReturnValue(argv);
    mockCreateContainer.mockReturnValue(buildFakeContainer());
    jestGlobal.isolateModules(() => {
        require(SCRIPT_PATH);
    });
    await flush();
    await flush();
}

describe('changeSourceAssigningAuthority.js (admin script)', () => {
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

    test('missing --oldSourceAssigningAuthority throws before constructing any runner', async () => {
        await runScript({ newSourceAssigningAuthority: 'new_client' });
        expect(mockRunnerCtor).not.toHaveBeenCalled();
        expect(consoleErrorSpy).toHaveBeenCalled();
        const loggedError = consoleErrorSpy.mock.calls[0][0];
        expect(String(loggedError.message || loggedError)).toMatch(/oldSourceAssigningAuthority is a required parameter/);
    });

    test('missing --newSourceAssigningAuthority throws before constructing any runner', async () => {
        await runScript({ oldSourceAssigningAuthority: 'client' });
        expect(mockRunnerCtor).not.toHaveBeenCalled();
        expect(consoleErrorSpy).toHaveBeenCalled();
        const loggedError = consoleErrorSpy.mock.calls[0][0];
        expect(String(loggedError.message || loggedError)).toMatch(/newSourceAssigningAuthority is a required parameter/);
    });

    test('with both required params present, constructs the runner with them', async () => {
        await runScript(VALID_ARGV);
        const options = mockRunnerCtor.mock.calls[0][0];
        expect(options.oldSourceAssigningAuthority).toBe('client');
        expect(options.newSourceAssigningAuthority).toBe('new_client');
    });

    test('defaults collections to ["all"] when --collections is omitted', async () => {
        await runScript(VALID_ARGV);
        expect(mockRunnerCtor.mock.calls[0][0].collections).toEqual(['all']);
    });

    test('splits and trims a comma-separated --collections', async () => {
        await runScript({ ...VALID_ARGV, collections: 'Patient_4_0_0 , Person_4_0_0' });
        expect(mockRunnerCtor.mock.calls[0][0].collections).toEqual(['Patient_4_0_0', 'Person_4_0_0']);
    });

    test('defaults batchSize to 10000 when neither --batchSize nor BULK_BUFFER_SIZE is set', async () => {
        const original = process.env.BULK_BUFFER_SIZE;
        delete process.env.BULK_BUFFER_SIZE;
        try {
            await runScript(VALID_ARGV);
            expect(mockRunnerCtor.mock.calls[0][0].batchSize).toBe(10000);
        } finally {
            if (original !== undefined) process.env.BULK_BUFFER_SIZE = original;
        }
    });

    test('parses --after and --before into Date objects', async () => {
        await runScript({ ...VALID_ARGV, after: '2021-12-31', before: '2022-01-15' });
        const options = mockRunnerCtor.mock.calls[0][0];
        expect(options.afterLastUpdatedDate).toBeInstanceOf(Date);
        expect(options.beforeLastUpdatedDate).toBeInstanceOf(Date);
    });

    test('coerces useTransaction with !!', async () => {
        await runScript({ ...VALID_ARGV, useTransaction: 'x' });
        expect(mockRunnerCtor.mock.calls[0][0].useTransaction).toBe(true);
    });

    test('awaits runner.processAsync() then exits 0 on success', async () => {
        await runScript(VALID_ARGV);
        expect(mockProcessAsync).toHaveBeenCalledTimes(1);
        expect(exitSpy).toHaveBeenCalledWith(0);
    });
});
