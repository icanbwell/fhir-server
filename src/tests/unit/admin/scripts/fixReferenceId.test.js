'use strict';
const { describe, test, expect, beforeEach, afterEach, jest: jestGlobal } = require('@jest/globals');

/**
 * fixReferenceId.js: CLI wrapper around FixReferenceIdRunner. `proaCollections` defaults to the
 * built-in proaResources list expanded into BOTH `<name>_4_0_0` and `<name>_4_0_0_History`
 * variants when --proaCollections is omitted; `collections` (the actual processing target)
 * independently defaults to `['all']`.
 */

const SCRIPT_PATH = '../../../../admin/scripts/fixReferenceId';
const RUNNER_PATH = '../../../../admin/runners/fixReferenceIdRunner';
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
    FixReferenceIdRunner: mockRunnerCtor
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

async function runScript (argv) {
    mockParseCommandLine.mockReturnValue(argv);
    mockCreateContainer.mockReturnValue(buildFakeContainer());
    jestGlobal.isolateModules(() => {
        require(SCRIPT_PATH);
    });
    await flush();
    await flush();
}

describe('fixReferenceId.js (admin script)', () => {
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
        expect(mockRunnerCtor.mock.calls[0][0].collections).toEqual(['all']);
    });

    test('splits and trims an explicit comma-separated --collections', async () => {
        await runScript({ collections: 'Patient_4_0_0 , Person_4_0_0' });
        expect(mockRunnerCtor.mock.calls[0][0].collections).toEqual(['Patient_4_0_0', 'Person_4_0_0']);
    });

    test('defaults proaCollections to the built-in list expanded with both base and _History variants', async () => {
        await runScript({});
        const options = mockRunnerCtor.mock.calls[0][0];
        expect(options.proaCollections).toContain('Patient_4_0_0');
        expect(options.proaCollections).toContain('Patient_4_0_0_History');
        expect(options.proaCollections).toContain('Condition_4_0_0');
        expect(options.proaCollections).toContain('Condition_4_0_0_History');
    });

    test('an explicit --proaCollections replaces the default expansion entirely', async () => {
        await runScript({ proaCollections: 'Patient_4_0_0' });
        expect(mockRunnerCtor.mock.calls[0][0].proaCollections).toEqual(['Patient_4_0_0']);
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

    test('splits and trims --properties and --filterToRecordsWithFields', async () => {
        await runScript({ properties: 'a , b', filterToRecordsWithFields: 'link , identifier' });
        const options = mockRunnerCtor.mock.calls[0][0];
        expect(options.properties).toEqual(['a', 'b']);
        expect(options.filterToRecordsWithFields).toEqual(['link', 'identifier']);
    });

    test('parses --after and --before into Date objects', async () => {
        await runScript({ after: '2021-12-31', before: '2022-01-15' });
        const options = mockRunnerCtor.mock.calls[0][0];
        expect(options.afterLastUpdatedDate).toBeInstanceOf(Date);
        expect(options.beforeLastUpdatedDate).toBeInstanceOf(Date);
    });

    test('coerces useTransaction with !!', async () => {
        await runScript({ useTransaction: 1 });
        expect(mockRunnerCtor.mock.calls[0][0].useTransaction).toBe(true);
    });

    test('awaits runner.processAsync() then exits 0 on success', async () => {
        await runScript({});
        expect(mockProcessAsync).toHaveBeenCalledTimes(1);
        expect(exitSpy).toHaveBeenCalledWith(0);
    });
});
