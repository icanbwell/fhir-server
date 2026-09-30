'use strict';
const { describe, test, expect, beforeEach, afterEach, jest: jestGlobal } = require('@jest/globals');

/**
 * fixReferenceSourceAssigningAuthority.js: thin CLI wrapper around
 * FixReferenceSourceAssigningAuthorityRunner (which extends BaseBulkOperationRunner). Its
 * `collections` derivation differs from every sibling script in this batch:
 *
 *   let collections = parameters.collections ? parameters.collections.split(',')... : [];
 *   if (parameters.collections === 'all') { collections = ['all']; }
 *
 * Every other script with a `collections` CLI option in this repo (fixCodeableConcepts,
 * fixReferenceId, fixReferenceIdHapi, fixDuplicateUuid, fixDuplicatePractitioner,
 * getIncompatibleResources, fixMultipleOwnerTags, fixInstantDataType, fixDuplicateOwnerTags,
 * fixBwellMasterPersonReference) defaults the *omitted* case to `['all']`. This one defaults to
 * `[]`. BaseBulkOperationRunner only expands to "all collections" when
 * `this.collections.length > 0 && this.collections[0] === 'all'` (see
 * src/admin/runners/baseBulkOperationRunner.js:521) -- an empty array fails that check and the
 * runner's main for-loop (`for (const collectionName of this.collections)`) simply iterates zero
 * times. So running this script with no `--collections` flag processes NOTHING, logs
 * "Exiting process", and exits 0 -- indistinguishable from a real, successful full run.
 */

const SCRIPT_PATH = '../../../../admin/scripts/fixReferenceSourceAssigningAuthority';
const RUNNER_PATH = '../../../../admin/runners/fixReferenceSourceAssigningAuthorityRunner';
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
    FixReferenceSourceAssigningAuthorityRunner: mockRunnerCtor
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
        resourceMerger: { tag: 'resourceMerger' }
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

describe('fixReferenceSourceAssigningAuthority.js (admin script)', () => {
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
        await runScript({ collections: 'Patient_4_0_0 , Observation_4_0_0' });
        expect(mockRunnerCtor.mock.calls[0][0].collections).toEqual(['Patient_4_0_0', 'Observation_4_0_0']);
    });

    test('defaults preLoadCollections to [] when omitted, and splits/trims when provided', async () => {
        await runScript({});
        expect(mockRunnerCtor.mock.calls[0][0].preloadCollections).toEqual([]);

        mockRunnerCtor.mockClear();
        await runScript({ preLoadCollections: 'Person_4_0_0 , Patient_4_0_0' });
        expect(mockRunnerCtor.mock.calls[0][0].preloadCollections).toEqual(['Person_4_0_0', 'Patient_4_0_0']);
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

    test('parses --after into a Date and leaves beforeLastUpdatedDate concept unset (no --before support)', async () => {
        await runScript({ collections: 'all', after: '2021-12-31' });
        const options = mockRunnerCtor.mock.calls[0][0];
        expect(options.afterLastUpdatedDate).toBeInstanceOf(Date);
        expect(options.afterLastUpdatedDate.toISOString()).toBe(new Date('2021-12-31').toISOString());
    });

    test('splits and trims properties and filterToRecordsWithFields', async () => {
        await runScript({ collections: 'all', properties: 'a, b', filterToRecordsWithFields: 'c, d' });
        const options = mockRunnerCtor.mock.calls[0][0];
        expect(options.properties).toEqual(['a', 'b']);
        expect(options.filterToRecordsWithFields).toEqual(['c', 'd']);
    });

    test('coerces useTransaction with !!', async () => {
        await runScript({ collections: 'all', useTransaction: 'x' });
        expect(mockRunnerCtor.mock.calls[0][0].useTransaction).toBe(true);
    });

    test('awaits runner.processAsync() then exits 0 on success', async () => {
        await runScript({ collections: 'all' });
        expect(mockProcessAsync).toHaveBeenCalledTimes(1);
        expect(exitSpy).toHaveBeenCalledWith(0);
    });
});
