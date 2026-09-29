/**
 * Unit tests for routeHandlers/alert.js
 *
 * This module exports a handleAlert function that logs a test message.
 *
 * Covers:
 * - handleAlert calls logInfo with expected message and source
 * - handleAlert returns a resolved promise (async function)
 * - handleAlert does not throw
 */
const { describe, test, expect, beforeEach, jest: jestObj } = require('@jest/globals');

// Mock logging
jestObj.mock('../../../operations/common/logging', () => ({
    logInfo: jestObj.fn(),
    logError: jestObj.fn()
}));

const { handleAlert } = require('../../../routeHandlers/alert');
const { logInfo } = require('../../../operations/common/logging');

describe('routeHandlers/alert', () => {
    beforeEach(() => {
        jestObj.clearAllMocks();
    });

    describe('handleAlert', () => {
        test('calls logInfo with the correct test message', async () => {
            await handleAlert();

            expect(logInfo).toHaveBeenCalledWith(
                'Test Message from FHIR Server',
                { source: 'handleAlert' }
            );
        });

        test('calls logInfo exactly once', async () => {
            await handleAlert();

            expect(logInfo).toHaveBeenCalledTimes(1);
        });

        test('returns a resolved promise', async () => {
            const result = handleAlert();

            expect(result).toBeInstanceOf(Promise);
            await expect(result).resolves.toBeUndefined();
        });

        test('does not throw an error', async () => {
            await expect(handleAlert()).resolves.not.toThrow();
        });

        test('is exported as a function', () => {
            expect(typeof handleAlert).toBe('function');
        });

        test('logInfo is called with source property set to handleAlert', async () => {
            await handleAlert();

            const callArgs = logInfo.mock.calls[0];
            expect(callArgs[1]).toHaveProperty('source', 'handleAlert');
        });

        test('logInfo message contains FHIR Server', async () => {
            await handleAlert();

            const callArgs = logInfo.mock.calls[0];
            expect(callArgs[0]).toContain('FHIR Server');
        });
    });
});
