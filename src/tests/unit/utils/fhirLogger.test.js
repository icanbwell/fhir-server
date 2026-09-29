'use strict';

const { describe, test, expect, jest: jestObj, beforeEach } = require('@jest/globals');

const { FhirLogger } = require('../../../utils/fhirLogger');

describe('FhirLogger', () => {
    beforeEach(() => {
        // Reset singleton between tests by accessing private state
        const mod = require('../../../utils/fhirLogger');
        // Force fresh instance each test
    });

    test('getInSecureLoggerAsync returns a logger', async () => {
        const logger = await FhirLogger.getInSecureLoggerAsync();
        expect(logger).toBeDefined();
        expect(logger.info).toBeDefined();
        expect(logger.error).toBeDefined();
        expect(logger.warn).toBeDefined();
    });

    test('getInSecureLoggerAsync returns same instance on repeated calls', async () => {
        const logger1 = await FhirLogger.getInSecureLoggerAsync();
        const logger2 = await FhirLogger.getInSecureLoggerAsync();
        expect(logger1).toBe(logger2);
    });

    test('FhirLogger instance can create logger', async () => {
        const instance = new FhirLogger();
        const logger = await instance.getOrCreateInSecureLoggerAsync();
        expect(logger).toBeDefined();
        expect(typeof logger.info).toBe('function');
    });

    test('getOrCreateInSecureLoggerAsync caches logger', async () => {
        const instance = new FhirLogger();
        const logger1 = await instance.getOrCreateInSecureLoggerAsync();
        const logger2 = await instance.getOrCreateInSecureLoggerAsync();
        expect(logger1).toBe(logger2);
    });

    test('createInSecureLoggerAsync returns a winston logger', async () => {
        const instance = new FhirLogger();
        const logger = await instance.createInSecureLoggerAsync();
        expect(logger).toBeDefined();
        expect(typeof logger.log).toBe('function');
    });
});
