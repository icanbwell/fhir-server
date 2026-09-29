'use strict';

const { describe, test, expect, beforeEach, afterEach, jest: jestObj } = require('@jest/globals');

// Mock dependencies before requiring the module under test
jestObj.mock('moment-timezone', () => {
    const mockMoment = {
        format: jestObj.fn().mockReturnValue('2024-06-15T10:30:00.000+0000')
    };
    const momentFn = jestObj.fn(() => mockMoment);
    momentFn.utc = jestObj.fn(() => mockMoment);
    return momentFn;
});

jestObj.mock('express-http-context', () => ({
    get: jestObj.fn()
}));

jestObj.mock('os', () => ({
    hostname: jestObj.fn().mockReturnValue('test-host-01')
}));

jestObj.mock('../../../../utils/uid.util', () => ({
    generateUUID: jestObj.fn().mockReturnValue('generated-uuid-123')
}));

jestObj.mock('../../../../utils/getCircularReplacer', () => ({
    getCircularReplacer: jestObj.fn().mockReturnValue(null)
}));

const mockInfo = jestObj.fn();
const mockError = jestObj.fn();

jestObj.mock('../../../../utils/fhirLogger', () => ({
    FhirLogger: {
        getInSecureLoggerAsync: jestObj.fn().mockResolvedValue({
            info: mockInfo,
            error: mockError
        })
    }
}));

jestObj.mock('../../../../constants', () => ({
    REQUEST_ID_TYPE: {
        USER_REQUEST_ID: 'userRequestId',
        SYSTEM_GENERATED_REQUEST_ID: 'systemGeneratedRequestId'
    }
}));

const { logSystemEventAsync, logTraceSystemEventAsync, logSystemErrorAsync } = require('../../../../operations/common/systemEventLogging');
const httpContext = require('express-http-context');
const os = require('os');
const { getCircularReplacer } = require('../../../../utils/getCircularReplacer');

describe('systemEventLogging', () => {
    const originalEnv = process.env;

    beforeEach(() => {
        jestObj.clearAllMocks();
        process.env = { ...originalEnv };
        os.hostname.mockReturnValue('test-host-01');
        httpContext.get.mockImplementation((key) => {
            if (key === 'userRequestId') return 'user-req-id-abc';
            if (key === 'systemGeneratedRequestId') return 'sys-req-id-xyz';
            return undefined;
        });
    });

    afterEach(() => {
        process.env = originalEnv;
    });

    describe('logSystemEventAsync', () => {
        test('should call fhirInSecureLogger.info with correct log entry structure', async () => {
            await logSystemEventAsync({
                event: 'test-event',
                message: 'Something happened',
                args: { key1: 'value1' }
            });

            expect(mockInfo).toHaveBeenCalledTimes(1);
            const logEntry = mockInfo.mock.calls[0][0];
            expect(logEntry.id).toBe('generated-uuid-123');
            expect(logEntry.type).toEqual({ code: 'system' });
            expect(logEntry.action).toBe('test-event');
            expect(logEntry.outcome).toBe(0);
            expect(logEntry.outcomeDesc).toBe('Success');
            expect(logEntry.message).toBe('Something happened');
        });

        test('should include hostname in detail array', async () => {
            await logSystemEventAsync({
                event: 'evt',
                message: 'msg',
                args: {}
            });

            const logEntry = mockInfo.mock.calls[0][0];
            const detail = logEntry.entity[0].detail;
            const hostEntry = detail.find((d) => d.type === 'host');
            expect(hostEntry).toBeDefined();
            expect(hostEntry.valueString).toBe('test-host-01');
        });

        test('should include httpContext request IDs', async () => {
            await logSystemEventAsync({
                event: 'evt',
                message: 'msg',
                args: {}
            });

            const logEntry = mockInfo.mock.calls[0][0];
            expect(logEntry.request.id).toBe('user-req-id-abc');
            expect(logEntry.request.systemGeneratedRequestId).toBe('sys-req-id-xyz');
        });

        test('should convert args object entries to detail array', async () => {
            await logSystemEventAsync({
                event: 'evt',
                message: 'msg',
                args: { foo: 'bar', count: '42' }
            });

            const logEntry = mockInfo.mock.calls[0][0];
            const detail = logEntry.entity[0].detail;
            expect(detail).toContainEqual({ type: 'foo', valueString: 'bar' });
            expect(detail).toContainEqual({ type: 'count', valueString: '42' });
        });

        test('should stringify non-string values in args using circular replacer', async () => {
            await logSystemEventAsync({
                event: 'evt',
                message: 'msg',
                args: { data: { nested: true } }
            });

            const logEntry = mockInfo.mock.calls[0][0];
            const detail = logEntry.entity[0].detail;
            const dataEntry = detail.find((d) => d.type === 'data');
            expect(dataEntry.valueString).toBe(JSON.stringify({ nested: true }, null));
        });

        test('should handle null/undefined values in args', async () => {
            await logSystemEventAsync({
                event: 'evt',
                message: 'msg',
                args: { nullVal: null, undefVal: undefined }
            });

            const logEntry = mockInfo.mock.calls[0][0];
            const detail = logEntry.entity[0].detail;
            const nullEntry = detail.find((d) => d.type === 'nullVal');
            const undefEntry = detail.find((d) => d.type === 'undefVal');
            // null and undefined are falsy, so they go through the string path (!v is true)
            expect(nullEntry.valueString).toBe(null);
            expect(undefEntry.valueString).toBe(undefined);
        });

        test('should not add hostname when os.hostname() returns empty string', async () => {
            os.hostname.mockReturnValue('');

            await logSystemEventAsync({
                event: 'evt',
                message: 'msg',
                args: { key: 'val' }
            });

            const logEntry = mockInfo.mock.calls[0][0];
            const detail = logEntry.entity[0].detail;
            const hostEntry = detail.find((d) => d.type === 'host');
            // Empty string is falsy, so hostname should NOT be added
            expect(hostEntry).toBeUndefined();
        });

        test('should set recorded timestamp from moment.utc', async () => {
            await logSystemEventAsync({
                event: 'evt',
                message: 'msg',
                args: {}
            });

            const logEntry = mockInfo.mock.calls[0][0];
            expect(logEntry.recorded).toEqual(new Date('2024-06-15T10:30:00.000+0000'));
        });
    });

    describe('logTraceSystemEventAsync', () => {
        test('should log when LOGLEVEL is TRACE', async () => {
            process.env.LOGLEVEL = 'TRACE';

            await logTraceSystemEventAsync({
                event: 'trace-event',
                message: 'trace msg',
                args: { traceKey: 'traceVal' }
            });

            expect(mockInfo).toHaveBeenCalledTimes(1);
        });

        test('should log when LOGLEVEL is DEBUG', async () => {
            process.env.LOGLEVEL = 'DEBUG';

            await logTraceSystemEventAsync({
                event: 'trace-event',
                message: 'trace msg',
                args: {}
            });

            expect(mockInfo).toHaveBeenCalledTimes(1);
        });

        test('should be a no-op when LOGLEVEL is INFO', async () => {
            process.env.LOGLEVEL = 'INFO';

            await logTraceSystemEventAsync({
                event: 'trace-event',
                message: 'trace msg',
                args: {}
            });

            expect(mockInfo).not.toHaveBeenCalled();
        });

        test('should be a no-op when LOGLEVEL is not set', async () => {
            delete process.env.LOGLEVEL;

            await logTraceSystemEventAsync({
                event: 'trace-event',
                message: 'trace msg',
                args: {}
            });

            expect(mockInfo).not.toHaveBeenCalled();
        });

        test('should be a no-op when LOGLEVEL is ERROR', async () => {
            process.env.LOGLEVEL = 'ERROR';

            await logTraceSystemEventAsync({
                event: 'trace-event',
                message: 'trace msg',
                args: {}
            });

            expect(mockInfo).not.toHaveBeenCalled();
        });
    });

    describe('logSystemErrorAsync', () => {
        test('should set outcome=8 when error is present', async () => {
            const error = new Error('something went wrong');

            await logSystemErrorAsync({
                event: 'error-event',
                message: 'Error occurred',
                args: {},
                error
            });

            expect(mockError).toHaveBeenCalledTimes(1);
            const logEntry = mockError.mock.calls[0][0];
            expect(logEntry.outcome).toBe(8);
            expect(logEntry.outcomeDesc).toBe('Error');
        });

        test('should call .error() not .info() when error is present', async () => {
            const error = new Error('bad thing');

            await logSystemErrorAsync({
                event: 'error-event',
                message: 'Failure',
                args: {},
                error
            });

            expect(mockError).toHaveBeenCalledTimes(1);
            expect(mockInfo).not.toHaveBeenCalled();
        });

        test('should call .info() when no error is present', async () => {
            await logSystemErrorAsync({
                event: 'warn-event',
                message: 'No error',
                args: {},
                error: null
            });

            expect(mockInfo).toHaveBeenCalledTimes(1);
            expect(mockError).not.toHaveBeenCalled();
            const logEntry = mockInfo.mock.calls[0][0];
            expect(logEntry.outcome).toBe(0);
            expect(logEntry.outcomeDesc).toBe('Success');
        });

        test('should append error.stack to message when error is present', async () => {
            const error = new Error('stack trace error');
            error.stack = 'Error: stack trace error\n    at Test.fn (file.js:1:1)';

            await logSystemErrorAsync({
                event: 'error-event',
                message: 'Base message',
                args: {},
                error
            });

            const logEntry = mockError.mock.calls[0][0];
            expect(logEntry.message).toContain('Base message');
            expect(logEntry.message).toContain('stack trace error');
        });

        test('should not modify message when error is null', async () => {
            await logSystemErrorAsync({
                event: 'event',
                message: 'Clean message',
                args: {},
                error: null
            });

            const logEntry = mockInfo.mock.calls[0][0];
            expect(logEntry.message).toBe('Clean message');
        });

        test('should include hostname in detail array', async () => {
            await logSystemErrorAsync({
                event: 'event',
                message: 'msg',
                args: {},
                error: new Error('err')
            });

            const logEntry = mockError.mock.calls[0][0];
            const detail = logEntry.entity[0].detail;
            const hostEntry = detail.find((d) => d.type === 'host');
            expect(hostEntry).toBeDefined();
            expect(hostEntry.valueString).toBe('test-host-01');
        });

        test('should include httpContext request IDs in error log', async () => {
            await logSystemErrorAsync({
                event: 'event',
                message: 'msg',
                args: {},
                error: new Error('err')
            });

            const logEntry = mockError.mock.calls[0][0];
            expect(logEntry.request.id).toBe('user-req-id-abc');
            expect(logEntry.request.systemGeneratedRequestId).toBe('sys-req-id-xyz');
        });

        test('should use getCircularReplacer when stringifying error.stack', async () => {
            const error = new Error('circular ref test');

            await logSystemErrorAsync({
                event: 'event',
                message: 'msg',
                args: {},
                error
            });

            expect(getCircularReplacer).toHaveBeenCalled();
        });

        test('should convert args to detail array in error logs', async () => {
            await logSystemErrorAsync({
                event: 'event',
                message: 'msg',
                args: { operation: 'search', resourceType: 'Patient' },
                error: new Error('err')
            });

            const logEntry = mockError.mock.calls[0][0];
            const detail = logEntry.entity[0].detail;
            expect(detail).toContainEqual({ type: 'operation', valueString: 'search' });
            expect(detail).toContainEqual({ type: 'resourceType', valueString: 'Patient' });
        });
    });
});
