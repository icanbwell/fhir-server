'use strict';
const { describe, test, expect, beforeEach, afterEach, jest: jestGlobal } = require('@jest/globals');

/**
 * fixBwellMasterPersonReference.js: thin CLI wrapper around FixBwellMasterPersonReferenceRunner.
 * Both `collections` and `preLoadCollections` default to ['all'] when omitted (unlike
 * fixReferenceSourceAssigningAuthority.js's `preLoadCollections`, which defaults to []).
 */

const SCRIPT_PATH = '../../../../admin/scripts/fixBwellMasterPersonReference';
const RUNNER_PATH = '../../../../admin/runners/fixBwellMasterPersonReferenceRunner';
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
    FixBwellMasterPersonReferenceRunner: mockRunnerCtor
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

describe('fixBwellMasterPersonReference.js (admin script)', () => {
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

    test('defaults both collections and preLoadCollections to ["all"] when omitted', async () => {
        await runScript({});
        const options = mockRunnerCtor.mock.calls[0][0];
        expect(options.collections).toEqual(['all']);
        expect(options.preLoadCollections).toEqual(['all']);
    });

    test('splits and trims explicit --collections and --preLoadCollections', async () => {
        await runScript({ collections: 'Person_4_0_0', preLoadCollections: 'Patient_4_0_0 , Person_4_0_0' });
        const options = mockRunnerCtor.mock.calls[0][0];
        expect(options.collections).toEqual(['Person_4_0_0']);
        expect(options.preLoadCollections).toEqual(['Patient_4_0_0', 'Person_4_0_0']);
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

    test('coerces useTransaction and logUnresolvedReferencesToFile with !!', async () => {
        await runScript({ useTransaction: 1, logUnresolvedReferencesToFile: 'yes' });
        const options = mockRunnerCtor.mock.calls[0][0];
        expect(options.useTransaction).toBe(true);
        expect(options.logUnresolvedReferencesToFile).toBe(true);

        mockRunnerCtor.mockClear();
        await runScript({});
        const options2 = mockRunnerCtor.mock.calls[0][0];
        expect(options2.useTransaction).toBe(false);
        expect(options2.logUnresolvedReferencesToFile).toBe(false);
    });

    test('parses --after and --before into Date objects', async () => {
        await runScript({ after: '2021-12-31', before: '2022-01-15' });
        const options = mockRunnerCtor.mock.calls[0][0];
        expect(options.afterLastUpdatedDate).toBeInstanceOf(Date);
        expect(options.beforeLastUpdatedDate).toBeInstanceOf(Date);
    });

    test('passes startFromCollection, limit, skip and startFromId through untouched', async () => {
        await runScript({ startFromCollection: 'Person_4_0_0', limit: 5, skip: 1, startFromId: 'id-9' });
        const options = mockRunnerCtor.mock.calls[0][0];
        expect(options.startFromCollection).toBe('Person_4_0_0');
        expect(options.limit).toBe(5);
        expect(options.skip).toBe(1);
        expect(options.startFromId).toBe('id-9');
    });

    test('awaits runner.processAsync() then exits 0 on success', async () => {
        await runScript({});
        expect(mockProcessAsync).toHaveBeenCalledTimes(1);
        expect(exitSpy).toHaveBeenCalledWith(0);
    });
});
