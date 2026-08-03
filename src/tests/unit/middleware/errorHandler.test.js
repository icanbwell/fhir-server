const { describe, test, expect, jest: jestObj, beforeEach, afterEach } = require('@jest/globals');

// Mock dependencies before requiring the module
jestObj.mock('@sentry/node', () => ({
    captureException: jestObj.fn()
}));

jestObj.mock('../../../operations/common/logging', () => ({
    logInfo: jestObj.fn(),
    logError: jestObj.fn()
}));

const Sentry = require('@sentry/node');
const { logInfo, logError } = require('../../../operations/common/logging');

describe('errorHandler middleware', () => {
    let originalListeners;
    let processOnSpy;

    beforeEach(() => {
        jestObj.clearAllMocks();
        // Store references to listeners registered by require
        originalListeners = {
            uncaughtException: process.listeners('uncaughtException').slice(),
            unhandledRejection: process.listeners('unhandledRejection').slice(),
            warning: process.listeners('warning').slice(),
            exit: process.listeners('exit').slice()
        };
    });

    afterEach(() => {
        // We don't remove listeners since the module registers them on require
    });

    test('module loads without error', () => {
        expect(() => require('../../../middleware/errorHandler')).not.toThrow();
    });

    describe('uncaughtException handler', () => {
        test('process has an uncaughtException listener registered', () => {
            require('../../../middleware/errorHandler');
            const listeners = process.listeners('uncaughtException');
            expect(listeners.length).toBeGreaterThan(0);
        });
    });

    describe('unhandledRejection handler', () => {
        test('process has an unhandledRejection listener registered', () => {
            require('../../../middleware/errorHandler');
            const listeners = process.listeners('unhandledRejection');
            expect(listeners.length).toBeGreaterThan(0);
        });
    });

    describe('warning handler', () => {
        test('process has a warning listener registered', () => {
            require('../../../middleware/errorHandler');
            const listeners = process.listeners('warning');
            expect(listeners.length).toBeGreaterThan(0);
        });
    });

    describe('exit handler', () => {
        test('process has an exit listener registered', () => {
            require('../../../middleware/errorHandler');
            const listeners = process.listeners('exit');
            expect(listeners.length).toBeGreaterThan(0);
        });
    });
});
