'use strict';
const { describe, test, expect, beforeEach, afterEach, jest: jestGlobal } = require('@jest/globals');

/**
 * addProxyPersonToConsentResource.js: thin CLI wrapper around AddProxyPatientToConsentResourceRunner.
 * Unlike most siblings, --collections defaults to ['Consent_4_0_0'] (not ['all']) when omitted.
 */

const SCRIPT_PATH = '../../../../admin/scripts/addProxyPersonToConsentResource';
const RUNNER_PATH = '../../../../admin/runners/addProxyPatientToConsentResource';
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
    AddProxyPatientToConsentResourceRunner: mockRunnerCtor
}));

const mockCreateContainer = jestGlobal.fn();
jestGlobal.mock(CONTAINER_PATH, () => ({
    createContainer: mockCreateContainer
}));

function buildFakeContainer () {
    const fakeContainer = {
        mongoDatabaseManager: { tag: 'mongoDatabaseManager' },
        bwellPersonFinder: { tag: 'bwellPersonFinder' },
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

describe('addProxyPersonToConsentResource.js (admin script)', () => {
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

    test('defaults collections to ["Consent_4_0_0"] when --collections is omitted', async () => {
        await runScript({});
        expect(mockRunnerCtor.mock.calls[0][0].collections).toEqual(['Consent_4_0_0']);
    });

    test('an explicit --collections overrides the Consent_4_0_0-only default', async () => {
        await runScript({ collections: 'Consent_4_0_0,Person_4_0_0' });
        expect(mockRunnerCtor.mock.calls[0][0].collections).toEqual(['Consent_4_0_0', 'Person_4_0_0']);
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

    test('parses --after and --before into Date objects', async () => {
        await runScript({ after: '2023-10-28', before: '2023-11-01' });
        const options = mockRunnerCtor.mock.calls[0][0];
        expect(options.afterLastUpdatedDate).toBeInstanceOf(Date);
        expect(options.beforeLastUpdatedDate).toBeInstanceOf(Date);
    });

    test('wires bwellPersonFinder and preSaveManager from the IoC container', async () => {
        await runScript({});
        const options = mockRunnerCtor.mock.calls[0][0];
        expect(options.bwellPersonFinder).toEqual({ tag: 'bwellPersonFinder' });
        expect(options.preSaveManager).toEqual({ tag: 'preSaveManager' });
    });

    test('awaits runner.processAsync() then exits 0 on success', async () => {
        await runScript({});
        expect(mockProcessAsync).toHaveBeenCalledTimes(1);
        expect(exitSpy).toHaveBeenCalledWith(0);
    });
});
