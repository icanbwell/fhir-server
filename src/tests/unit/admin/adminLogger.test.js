/**
 * Unit tests for admin/adminLogger.js
 *
 * AdminLogger wraps winston to create a child logger with 'admin' metadata.
 *
 * Covers:
 * - Constructor creates child logger from parent
 * - defaultMeta includes logger: 'admin'
 * - logInfo delegates to logger.info
 * - logError delegates to logger.error
 * - Messages and args are passed through correctly
 */
const { describe, test, expect, beforeEach, jest: jestObj } = require('@jest/globals');

// Mock winstonInit
const mockChildLogger = {
    info: jestObj.fn(),
    error: jestObj.fn(),
    defaultMeta: {}
};

const mockParentLogger = {
    child: jestObj.fn(() => mockChildLogger),
    defaultMeta: { version: '1.0.0', logger: 'default' }
};

jestObj.mock('../../../winstonInit', () => ({
    getLogger: jestObj.fn(() => mockParentLogger)
}));

const { AdminLogger } = require('../../../admin/adminLogger');
const { getLogger } = require('../../../winstonInit');

describe('AdminLogger', () => {
    let adminLogger;

    beforeEach(() => {
        jestObj.clearAllMocks();
        // Reset defaultMeta on child so we can track what constructor sets
        mockChildLogger.defaultMeta = {};
        adminLogger = new AdminLogger();
    });

    describe('constructor', () => {
        test('calls getLogger to obtain the parent logger', () => {
            expect(getLogger).toHaveBeenCalled();
        });

        test('creates a child logger from the parent', () => {
            expect(mockParentLogger.child).toHaveBeenCalled();
        });

        test('sets defaultMeta with logger set to admin', () => {
            expect(mockChildLogger.defaultMeta).toEqual(
                expect.objectContaining({ logger: 'admin' })
            );
        });

        test('preserves parent defaultMeta fields in child', () => {
            expect(mockChildLogger.defaultMeta).toEqual(
                expect.objectContaining({ version: '1.0.0' })
            );
        });

        test('overrides parent logger field with admin', () => {
            // Parent has logger: 'default', child should have logger: 'admin'
            expect(mockChildLogger.defaultMeta.logger).toBe('admin');
        });
    });

    describe('logInfo', () => {
        test('delegates to logger.info with message and args', () => {
            adminLogger.logInfo('Test info message', { key: 'value' });

            expect(mockChildLogger.info).toHaveBeenCalledWith('Test info message', { key: 'value' });
        });

        test('handles message without args', () => {
            adminLogger.logInfo('Simple message');

            expect(mockChildLogger.info).toHaveBeenCalledWith('Simple message', undefined);
        });

        test('calls info exactly once per invocation', () => {
            adminLogger.logInfo('msg1', {});
            adminLogger.logInfo('msg2', {});

            expect(mockChildLogger.info).toHaveBeenCalledTimes(2);
        });

        test('passes complex args objects through unchanged', () => {
            const complexArgs = {
                nested: { deep: true },
                array: [1, 2, 3],
                error: new Error('test')
            };

            adminLogger.logInfo('complex', complexArgs);

            expect(mockChildLogger.info).toHaveBeenCalledWith('complex', complexArgs);
        });
    });

    describe('logError', () => {
        test('delegates to logger.error with message and args', () => {
            adminLogger.logError('Test error message', { error: 'something broke' });

            expect(mockChildLogger.error).toHaveBeenCalledWith('Test error message', { error: 'something broke' });
        });

        test('handles message without args', () => {
            adminLogger.logError('Error occurred');

            expect(mockChildLogger.error).toHaveBeenCalledWith('Error occurred', undefined);
        });

        test('calls error exactly once per invocation', () => {
            adminLogger.logError('err1', {});

            expect(mockChildLogger.error).toHaveBeenCalledTimes(1);
        });

        test('passes error objects in args', () => {
            const err = new Error('DB connection failed');
            adminLogger.logError('Database error', { error: err.message, stack: err.stack });

            expect(mockChildLogger.error).toHaveBeenCalledWith(
                'Database error',
                expect.objectContaining({ error: 'DB connection failed' })
            );
        });
    });

    describe('instance isolation', () => {
        test('each instance gets its own child logger', () => {
            const secondChildLogger = {
                info: jestObj.fn(),
                error: jestObj.fn(),
                defaultMeta: {}
            };
            mockParentLogger.child.mockReturnValueOnce(secondChildLogger);

            const adminLogger2 = new AdminLogger();

            adminLogger.logInfo('first');
            adminLogger2.logInfo('second');

            expect(mockChildLogger.info).toHaveBeenCalledWith('first', undefined);
            expect(secondChildLogger.info).toHaveBeenCalledWith('second', undefined);
        });
    });
});
