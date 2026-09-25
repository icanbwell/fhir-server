'use strict';
const { describe, test, expect, beforeEach, afterEach, jest: jestGlobal } = require('@jest/globals');

/**
 * fixDuplicatePractitioner.js: thin CLI wrapper around FixDuplicatePractitionerRunner.
 */

const SCRIPT_PATH = '../../../../admin/scripts/fixDuplicatePractitioner';
const RUNNER_PATH = '../../../../admin/runners/fixDuplicatePractitionerRunner';
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
    FixDuplicatePractitionerRunner: mockRunnerCtor
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

describe('fixDuplicatePractitioner.js (admin script)', () => {
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

    test('splits and trims a comma-separated --collections', async () => {
        await runScript({ collections: 'Appointment_4_0_0 , Encounter_4_0_0' });
        expect(mockRunnerCtor.mock.calls[0][0].collections).toEqual(['Appointment_4_0_0', 'Encounter_4_0_0']);
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

    test('coerces deleteData and useTransaction with !!', async () => {
        await runScript({ deleteData: true, useTransaction: 1 });
        const options = mockRunnerCtor.mock.calls[0][0];
        expect(options.deleteData).toBe(true);
        expect(options.useTransaction).toBe(true);

        mockRunnerCtor.mockClear();
        await runScript({});
        const options2 = mockRunnerCtor.mock.calls[0][0];
        expect(options2.deleteData).toBe(false);
        expect(options2.useTransaction).toBe(false);
    });

    test('parses --after and --before into Date objects', async () => {
        await runScript({ after: '2023-10-28', before: '2023-11-01' });
        const options = mockRunnerCtor.mock.calls[0][0];
        expect(options.afterLastUpdatedDate).toBeInstanceOf(Date);
        expect(options.beforeLastUpdatedDate).toBeInstanceOf(Date);
    });

    test('awaits runner.processAsync() then exits 0 on success', async () => {
        await runScript({});
        expect(mockProcessAsync).toHaveBeenCalledTimes(1);
        expect(exitSpy).toHaveBeenCalledWith(0);
    });
});
