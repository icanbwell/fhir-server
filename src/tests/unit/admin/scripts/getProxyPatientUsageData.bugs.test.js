'use strict';

const { describe, test, expect, afterEach, jest } = require('@jest/globals');
const { SimpleContainer } = require('../../../../utils/simpleContainer');

/**
 * Failing by design.
 *
 * src/admin/scripts/getProxyPatientUsageData.js's own doc comment documents:
 *   node --max-old-space-size=8192 src/admin/scripts/getProxyPatientUsageData.js --csvFileName proxyPatientUsage.csv
 * as a usage example, implying `--csvFileName` selects the output file. The script actually
 * hardcodes `const csvFileName = 'proxyPatientUsage.csv';` and never reads
 * `parameters.csvFileName` -- the flag is a documented no-op. An operator who follows the
 * documented example to run several exports with different intended filenames will keep
 * overwriting the same `proxyPatientUsage.csv`, silently losing prior output.
 *
 * This test asserts the CORRECT behavior (the runner receives the caller's requested filename)
 * and therefore fails against current code. Quarantine this file in jest.unit.config.js's
 * testPathIgnorePatterns once triaged, and remove the entry once fixed.
 */

const SCRIPT_PATH = '../../../../admin/scripts/getProxyPatientUsageData';
const RUNNER_PATH = '../../../../admin/runners/getProxyPatientUsageDataRunner';
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

describe('admin/scripts/getProxyPatientUsageData.js ignores --csvFileName', () => {
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

        jest.doMock(RUNNER_PATH, () => ({ GetProxyPatientUsageDataRunner: MockRunner }));
        jest.doMock(CONTAINER_PATH, () => ({ createContainer: jest.fn(() => buildContainer()) }));
        jest.doMock(CLI_PARSER_PATH, () => ({
            CommandLineParser: { parseCommandLine: () => ({ csvFileName: 'custom-output.csv' }) }
        }));

        jest.spyOn(process, 'exit').mockImplementation(() => undefined);
        jest.spyOn(console, 'log').mockImplementation(() => undefined);
        jest.spyOn(console, 'error').mockImplementation(() => undefined);

        require(SCRIPT_PATH);
        await flushAsync();

        // Correct behavior per the script's own documented usage example: the runner should
        // receive the caller's requested filename. Current code hardcodes the constant instead,
        // so this assertion fails on current code -- that failure IS the bug report.
        expect(MockRunner.mock.calls[0][0].csvFileName).toBe('custom-output.csv');
    });
});
