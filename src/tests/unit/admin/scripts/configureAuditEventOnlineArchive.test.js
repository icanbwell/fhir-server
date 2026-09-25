'use strict';

const { describe, test, expect, afterEach, jest } = require('@jest/globals');
const { SimpleContainer } = require('../../../../utils/simpleContainer');

const SCRIPT_PATH = '../../../../admin/scripts/configureAuditEventOnlineArchive';
const RUNNER_PATH = '../../../../admin/runners/configureAuditEventOnlineArchiveRunner.js';
const CONTAINER_PATH = '../../../../createContainer';
const CLI_PARSER_PATH = '../../../../admin/scripts/commandLineParser';

function buildContainer (overrides = {}) {
    const container = new SimpleContainer();
    Object.assign(container, {
        mongoDatabaseManager: { marker: 'mongoDatabaseManager' }
    }, overrides);
    return container;
}

async function flushAsync (times = 15) {
    for (let i = 0; i < times; i++) {
        await Promise.resolve();
    }
}

async function runScript (parameters) {
    jest.resetModules();

    const mockProcessAsync = jest.fn().mockResolvedValue(undefined);
    const MockRunner = jest.fn().mockImplementation(function (args) {
        this.constructorArgs = args;
        this.processAsync = mockProcessAsync;
    });

    jest.doMock(RUNNER_PATH, () => ({ ConfigureAuditEventOnlineArchiveRunner: MockRunner }));
    jest.doMock(CONTAINER_PATH, () => ({ createContainer: jest.fn(() => buildContainer()) }));
    jest.doMock(CLI_PARSER_PATH, () => ({ CommandLineParser: { parseCommandLine: () => parameters } }));

    const exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => undefined);
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);

    require(SCRIPT_PATH);
    await flushAsync();

    return { MockRunner, mockProcessAsync, exitSpy, errorSpy };
}

describe('admin/scripts/configureAuditEventOnlineArchive.js', () => {
    afterEach(() => {
        jest.restoreAllMocks();
    });

    test('splits comma-separated collections into an array', async () => {
        const { MockRunner } = await runScript({ collections: 'AuditEvent_4_0_0_2023_09_09,AuditEvent_4_0_0_2023_09_10' });
        expect(MockRunner.mock.calls[0][0].collections).toEqual([
            'AuditEvent_4_0_0_2023_09_09',
            'AuditEvent_4_0_0_2023_09_10'
        ]);
    });

    test('collections is undefined when not supplied', async () => {
        const { MockRunner } = await runScript({});
        expect(MockRunner.mock.calls[0][0].collections).toBeUndefined();
    });

    test('expireAfterDays is converted from a string to a Number', async () => {
        const { MockRunner } = await runScript({ expireAfterDays: '60' });
        expect(MockRunner.mock.calls[0][0].expireAfterDays).toBe(60);
        expect(typeof MockRunner.mock.calls[0][0].expireAfterDays).toBe('number');
    });

    test('expireAfterDays is undefined when not supplied', async () => {
        const { MockRunner } = await runScript({});
        expect(MockRunner.mock.calls[0][0].expireAfterDays).toBeUndefined();
    });

    test('OBSERVATION: a non-numeric expireAfterDays currently passes through as NaN rather than being validated', async () => {
        // Pinning current behavior (not filed as a bug per RULE 17/18 -- validating the downstream
        // impact of a NaN expiry would require reading ConfigureAuditEventOnlineArchiveRunner,
        // which is out of scope for this file's test). Documented here so a future change to add
        // Number.isFinite validation is visible in review.
        const { MockRunner } = await runScript({ expireAfterDays: 'not-a-number' });
        expect(Number.isNaN(MockRunner.mock.calls[0][0].expireAfterDays)).toBe(true);
    });

    test('forwards mongoDatabaseManager from the container unchanged', async () => {
        const { MockRunner } = await runScript({});
        expect(MockRunner.mock.calls[0][0].mongoDatabaseManager).toEqual({ marker: 'mongoDatabaseManager' });
    });

    test('calls processAsync exactly once and exits with code 0 on success', async () => {
        const { mockProcessAsync, exitSpy } = await runScript({});
        expect(mockProcessAsync).toHaveBeenCalledTimes(1);
        expect(exitSpy).toHaveBeenCalledWith(0);
    });
});
