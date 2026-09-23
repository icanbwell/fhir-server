'use strict';
const { describe, test, expect, beforeEach, afterEach, jest: jestGlobal } = require('@jest/globals');

/**
 * fixCodeableConcepts.js: CLI wrapper around FixCodeableConceptsRunner with real branching:
 *  - --collections defaults to the de-duplicated union of its hapiResources/proaResources lists
 *    (`Array.from(new Set([...]))`) when omitted or "all".
 *  - --oidToStandardUrlMap is merged with the built-in default map via
 *      `{ ...JSON.parse(parameters.oidToStandardUrlMap), ...oidToStandardUrlMapDefault }`
 *    -- note the DEFAULT map is spread LAST, so it overwrites any user-supplied override for a
 *    key that already exists in the default map. This is backwards from what an operator passing
 *    `--oidToStandardUrlMap` to CUSTOMIZE a mapping would expect.
 */

const SCRIPT_PATH = '../../../../admin/scripts/fixCodeableConcepts';
const RUNNER_PATH = '../../../../admin/runners/fixCodeableConceptsRunner';
const CLP_PATH = '../../../../admin/scripts/commandLineParser';
const CONTAINER_PATH = '../../../../createContainer';
const LOGGER_PATH = '../../../../admin/adminLogger';
const oidToStandardUrlMapDefault = require('../../../../admin/utils/oidToStandardSystemUrlMapping.json');

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
    FixCodeableConceptsRunner: mockRunnerCtor
}));

const mockCreateContainer = jestGlobal.fn();
jestGlobal.mock(CONTAINER_PATH, () => ({
    createContainer: mockCreateContainer
}));

function buildFakeContainer () {
    const fakeContainer = {
        mongoDatabaseManager: { tag: 'mongoDatabaseManager' },
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

describe('fixCodeableConcepts.js (admin script)', () => {
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

    test('defaults collections to the de-duplicated union of hapi + proa resource collections', async () => {
        await runScript({});
        const options = mockRunnerCtor.mock.calls[0][0];
        expect(options.collections).toContain('Patient_4_0_0'); // present in both lists
        expect(options.collections).toContain('Coverage_4_0_0'); // proa-only
        expect(options.collections).toContain('Device_4_0_0'); // hapi-only
        // de-duplicated: appears once even though it's in both hapiResources and proaResources
        expect(options.collections.filter((c) => c === 'Patient_4_0_0')).toHaveLength(1);
    });

    test('"all" is also expanded to the de-duplicated union (same branch as omitted)', async () => {
        await runScript({ collections: 'all' });
        const options = mockRunnerCtor.mock.calls[0][0];
        expect(options.collections).toContain('Patient_4_0_0');
    });

    test('splits and trims an explicit comma-separated --collections', async () => {
        await runScript({ collections: 'Patient_4_0_0 , Person_4_0_0' });
        expect(mockRunnerCtor.mock.calls[0][0].collections).toEqual(['Patient_4_0_0', 'Person_4_0_0']);
    });

    test('--oidToStandardUrlMap cannot override a key already present in the default map', async () => {
        const existingKey = '2.16.840.1.113883.6.96';
        expect(oidToStandardUrlMapDefault[existingKey]).toBe('http://snomed.info/sct');

        await runScript({ oidToStandardUrlMap: JSON.stringify({ [existingKey]: 'http://custom-override' }) });
        const options = mockRunnerCtor.mock.calls[0][0];
        // Correct behavior: an operator-supplied override for a key should win over the built-in
        // default for that same key.
        expect(options.oidToStandardSystemUrlMap[existingKey]).toBe('http://custom-override');
    });

    test('a --oidToStandardUrlMap entry for a NEW key not in the default map is added correctly', async () => {
        await runScript({ oidToStandardUrlMap: JSON.stringify({ 'custom.oid.1': 'http://example.org/custom' }) });
        const options = mockRunnerCtor.mock.calls[0][0];
        expect(options.oidToStandardSystemUrlMap['custom.oid.1']).toBe('http://example.org/custom');
    });

    test('without --oidToStandardUrlMap, the default map is used as-is', async () => {
        await runScript({});
        expect(mockRunnerCtor.mock.calls[0][0].oidToStandardSystemUrlMap).toEqual(oidToStandardUrlMapDefault);
    });

    test('defaults batchSize to 10000 and promiseConcurrency to 10', async () => {
        const original = process.env.BULK_BUFFER_SIZE;
        delete process.env.BULK_BUFFER_SIZE;
        try {
            await runScript({});
            const options = mockRunnerCtor.mock.calls[0][0];
            expect(options.batchSize).toBe(10000);
            expect(options.promiseConcurrency).toBe(10);
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

    test('coerces useTransaction and updateResources with !!', async () => {
        await runScript({ useTransaction: 1, updateResources: 'x' });
        const options = mockRunnerCtor.mock.calls[0][0];
        expect(options.useTransaction).toBe(true);
        expect(options.updateResources).toBe(true);
    });

    test('awaits runner.processAsync() then exits 0 on success', async () => {
        await runScript({});
        expect(mockProcessAsync).toHaveBeenCalledTimes(1);
        expect(exitSpy).toHaveBeenCalledWith(0);
    });
});
