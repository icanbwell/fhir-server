'use strict';

const { describe, test, expect } = require('@jest/globals');
const { getLogger, initialize } = require('../../winstonInit');

describe('winstonInit', () => {
    test('getLogger returns a logger with info/error/warn/debug methods', () => {
        const logger = getLogger();
        expect(typeof logger.info).toBe('function');
        expect(typeof logger.error).toBe('function');
        expect(typeof logger.warn).toBe('function');
        expect(typeof logger.debug).toBe('function');
    });

    test('getLogger returns same instance for same name', () => {
        const logger1 = getLogger('test-logger');
        const logger2 = getLogger('test-logger');
        expect(logger1).toBe(logger2);
    });

    test('getLogger with different names returns different loggers', () => {
        const logger1 = getLogger('logger-a');
        const logger2 = getLogger('logger-b');
        expect(logger1).not.toBe(logger2);
    });

    test('initialize does not throw', () => {
        expect(() => initialize()).not.toThrow();
    });

    test('initialize can be called multiple times safely', () => {
        expect(() => {
            initialize();
            initialize();
        }).not.toThrow();
    });

    test('default logger has at least one transport after initialize', () => {
        initialize();
        const logger = getLogger();
        expect(logger.transports.length).toBeGreaterThan(0);
    });
});
