'use strict';

const { describe, test, expect, afterEach, jest } = require('@jest/globals');
const { SimpleContainer } = require('../../../../utils/simpleContainer');

/**
 * Failing by design. Same shape as the equivalent bug in getProxyPatientUsageData.js: the script
 * hardcodes `const csvFileName = 'masterPatientUsage.csv';` and never reads
 * `parameters.csvFileName`, so a caller cannot actually choose an output filename despite what
 * the flag name implies.
 *
 * This test asserts the CORRECT behavior and fails against current code. Quarantine this file in
 * jest.unit.config.js's testPathIgnorePatterns once triaged.
 */

const SCRIPT_PATH = '../../../../admin/scripts/getMasterPatientUsageData';
const RUNNER_PATH = '../../../../admin/runners/getMasterPatientUsageDataRunner';
const CONTAINER_PATH = '../../../../createContainer';
const CLI_PARSER_PATH = '../../../../admin/scripts/commandLineParser';

function buildContainer () {
    const container = new SimpleContainer();
    Object.assign(container, {
        mongoDatabaseManager: { marker: 'mongoDatabaseManager' },
        databaseQueryFactory: { marker: 'databaseQueryFactory' }
    });
    return container;
}

async function flushAsync (times = 15) {
    for (let i = 0; i < times; i++) {
        await Promise.resolve();
    }
}

describe('admin/scripts/getMasterPatientUsageData.js ignores --csvFileName', () => {
    afterEach(() => {
        jest.restoreAllMocks();
    });

    test('a caller-supplied --csvFileName should reach the runner instead of being silently dropped', async () => {
        jest.resetModules();

        const mockProcessAsync = jest.fn().mockResolvedValue(undefined);
        const MockRunner = jest.fn().mockImplementation(function (args) {
            this.constructorArgs = args;
            this.processAsync = mockProcessAsync;
        });

        jest.doMock(RUNNER_PATH, () => ({ GetMasterPatientUsageDataRunner: MockRunner }));
        jest.doMock(CONTAINER_PATH, () => ({ createContainer: jest.fn(() => buildContainer()) }));
        jest.doMock(CLI_PARSER_PATH, () => ({
            CommandLineParser: { parseCommandLine: () => ({ csvFileName: 'custom-master-output.csv' }) }
        }));

        jest.spyOn(process, 'exit').mockImplementation(() => undefined);
        jest.spyOn(console, 'log').mockImplementation(() => undefined);
        jest.spyOn(console, 'error').mockImplementation(() => undefined);

        require(SCRIPT_PATH);
        await flushAsync();

        expect(MockRunner.mock.calls[0][0].csvFileName).toBe('custom-master-output.csv');
    });
});
