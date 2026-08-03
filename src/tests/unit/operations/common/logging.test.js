'use strict';

const { describe, test, expect, beforeEach, afterEach, jest: jestObj } = require('@jest/globals');

const mockGet = jestObj.fn();
jestObj.mock('express-http-context', () => ({
    get: mockGet
}));

const mockLogger = {
    info: jestObj.fn(),
    debug: jestObj.fn(),
    error: jestObj.fn(),
    warn: jestObj.fn()
};
jestObj.mock('../../../../winstonInit', () => ({
    getLogger: () => mockLogger
}));

jestObj.mock('../../../../constants', () => ({
    REQUEST_ID_TYPE: {
        USER_REQUEST_ID: 'userRequestId',
        SYSTEM_GENERATED_REQUEST_ID: 'systemGeneratedRequestId'
    }
}));

const { logInfo, logDebug, logError, logWarn, logVerboseAsync } = require('../../../../operations/common/logging');

describe('logging', () => {
    let originalLogLevel;

    beforeEach(() => {
        originalLogLevel = process.env.LOGLEVEL;
        mockGet.mockReset();
        mockLogger.info.mockReset();
        mockLogger.debug.mockReset();
        mockLogger.error.mockReset();
        mockLogger.warn.mockReset();
    });

    afterEach(() => {
        if (originalLogLevel !== undefined) {
            process.env.LOGLEVEL = originalLogLevel;
        } else {
            delete process.env.LOGLEVEL;
        }
    });

    describe('logInfo', () => {
        test('calls logger.info with message and args', () => {
            mockGet.mockReturnValue(null);

            logInfo('test message', { foo: 'bar' });

            expect(mockLogger.info).toHaveBeenCalledWith('test message', { foo: 'bar' });
        });

        test('sets request id in args when system generated request id is present', () => {
            mockGet.mockImplementation((key) => {
                if (key === 'systemGeneratedRequestId') return 'sys-req-123';
                if (key === 'userRequestId') return 'user-req-456';
                return null;
            });

            const args = { someField: 'value' };
            logInfo('test message', args);

            expect(mockLogger.info).toHaveBeenCalledWith('test message', {
                someField: 'value',
                request: {
                    id: 'user-req-456',
                    systemGeneratedRequestId: 'sys-req-123'
                }
            });
        });

        test('preserves existing request properties in args', () => {
            mockGet.mockImplementation((key) => {
                if (key === 'systemGeneratedRequestId') return 'sys-req-123';
                if (key === 'userRequestId') return 'user-req-456';
                return null;
            });

            const args = { request: { existingProp: 'existing' } };
            logInfo('test message', args);

            expect(mockLogger.info).toHaveBeenCalledWith('test message', {
                request: {
                    existingProp: 'existing',
                    id: 'user-req-456',
                    systemGeneratedRequestId: 'sys-req-123'
                }
            });
        });

        test('does not set request id if reqId is null', () => {
            mockGet.mockReturnValue(null);

            const args = { foo: 'bar' };
            logInfo('test message', args);

            expect(args.request).toBeUndefined();
            expect(mockLogger.info).toHaveBeenCalledWith('test message', { foo: 'bar' });
        });

        test('does not set request id if args is null', () => {
            mockGet.mockReturnValue('some-req-id');

            logInfo('test message', null);

            expect(mockLogger.info).toHaveBeenCalledWith('test message', null);
        });
    });

    describe('logDebug', () => {
        test('calls logger.debug when LOGLEVEL is DEBUG', () => {
            process.env.LOGLEVEL = 'DEBUG';
            mockGet.mockReturnValue(null);

            logDebug('debug message', { data: 'value' });

            expect(mockLogger.debug).toHaveBeenCalledWith('debug message', { data: 'value' });
        });

        test('does not call logger.debug when LOGLEVEL is not DEBUG', () => {
            process.env.LOGLEVEL = 'INFO';
            mockGet.mockReturnValue(null);

            logDebug('debug message', { data: 'value' });

            expect(mockLogger.debug).not.toHaveBeenCalled();
        });

        test('does not call logger.debug when LOGLEVEL is unset', () => {
            delete process.env.LOGLEVEL;
            mockGet.mockReturnValue(null);

            logDebug('debug message', { data: 'value' });

            expect(mockLogger.debug).not.toHaveBeenCalled();
        });

        test('sets request id in args when DEBUG and system request id exists', () => {
            process.env.LOGLEVEL = 'DEBUG';
            mockGet.mockImplementation((key) => {
                if (key === 'systemGeneratedRequestId') return 'sys-req-789';
                if (key === 'userRequestId') return 'user-req-000';
                return null;
            });

            const args = {};
            logDebug('debug message', args);

            expect(args.request).toEqual({
                id: 'user-req-000',
                systemGeneratedRequestId: 'sys-req-789'
            });
        });
    });

    describe('logError', () => {
        test('calls logger.error with message and args', () => {
            mockGet.mockReturnValue(null);

            logError('error occurred', { error: 'details' });

            expect(mockLogger.error).toHaveBeenCalledWith('error occurred', { error: 'details' });
        });

        test('sets request id in args when system request id is present', () => {
            mockGet.mockImplementation((key) => {
                if (key === 'systemGeneratedRequestId') return 'sys-err-123';
                if (key === 'userRequestId') return 'user-err-456';
                return null;
            });

            const args = { error: 'something' };
            logError('error message', args);

            expect(mockLogger.error).toHaveBeenCalledWith('error message', {
                error: 'something',
                request: {
                    id: 'user-err-456',
                    systemGeneratedRequestId: 'sys-err-123'
                }
            });
        });
    });

    describe('logWarn', () => {
        test('calls logger.warn with message and args', () => {
            mockGet.mockReturnValue(null);

            logWarn('warning message', { detail: 'info' });

            expect(mockLogger.warn).toHaveBeenCalledWith('warning message', { detail: 'info' });
        });

        test('sets request id in args when system request id is present', () => {
            mockGet.mockImplementation((key) => {
                if (key === 'systemGeneratedRequestId') return 'sys-warn-123';
                if (key === 'userRequestId') return 'user-warn-456';
                return null;
            });

            const args = {};
            logWarn('warning message', args);

            expect(mockLogger.warn).toHaveBeenCalledWith('warning message', {
                request: {
                    id: 'user-warn-456',
                    systemGeneratedRequestId: 'sys-warn-123'
                }
            });
        });
    });

    describe('logVerboseAsync', () => {
        test('calls logInfo when LOGLEVEL is DEBUG', async () => {
            process.env.LOGLEVEL = 'DEBUG';
            mockGet.mockReturnValue(null);

            await logVerboseAsync({ source: 'TestSource', args: { key: 'value' } });

            expect(mockLogger.info).toHaveBeenCalledWith('TestSource', { args: { key: 'value' } });
        });

        test('does not call logInfo when LOGLEVEL is not DEBUG', async () => {
            process.env.LOGLEVEL = 'INFO';
            mockGet.mockReturnValue(null);

            await logVerboseAsync({ source: 'TestSource', args: { key: 'value' } });

            expect(mockLogger.info).not.toHaveBeenCalled();
        });

        test('does not call logInfo when LOGLEVEL is unset', async () => {
            delete process.env.LOGLEVEL;
            mockGet.mockReturnValue(null);

            await logVerboseAsync({ source: 'TestSource', args: { key: 'value' } });

            expect(mockLogger.info).not.toHaveBeenCalled();
        });

        test('passes source as the message string', async () => {
            process.env.LOGLEVEL = 'DEBUG';
            mockGet.mockReturnValue(null);

            await logVerboseAsync({ source: 'MyComponent', args: { data: 123 } });

            expect(mockLogger.info).toHaveBeenCalledWith('MyComponent', { args: { data: 123 } });
        });
    });
});
