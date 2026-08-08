'use strict';

const { describe, test, expect, beforeEach, jest: jestObj } = require('@jest/globals');

const mockSentryInit = jestObj.fn();
const mockValidateOpenTelemetrySetup = jestObj.fn();

jestObj.mock('@sentry/node', () => ({
    init: mockSentryInit,
    validateOpenTelemetrySetup: mockValidateOpenTelemetrySetup
}));

jestObj.mock('../../../utils/getImageVersion', () => ({
    getImageVersion: jestObj.fn(() => 'test-version')
}));

const { initSentry } = require('../../../utils/initSentry');

describe('initSentry', () => {
    beforeEach(() => {
        jestObj.clearAllMocks();
    });

    test('initializes Sentry with the standard options', () => {
        initSentry();

        expect(mockSentryInit).toHaveBeenCalledWith(
            expect.objectContaining({
                release: 'test-version',
                autoSessionTracking: false,
                skipOpenTelemetrySetup: true
            })
        );
    });

    test('does not validate OpenTelemetry setup by default', () => {
        initSentry();

        expect(mockValidateOpenTelemetrySetup).not.toHaveBeenCalled();
    });

    test('validates OpenTelemetry setup when explicitly requested', () => {
        initSentry({ validateOpenTelemetry: true });

        expect(mockValidateOpenTelemetrySetup).toHaveBeenCalled();
    });
});
