const { describe, test, expect, beforeEach, jest } = require('@jest/globals');

// Mock express-http-context
jest.mock('express-http-context', () => ({
    get: jest.fn(),
    set: jest.fn()
}));

// Mock fhirLogger
jest.mock('../../../../utils/fhirLogger', () => ({
    FhirLogger: {
        getInSecureLoggerAsync: jest.fn().mockResolvedValue({
            info: jest.fn(),
            error: jest.fn()
        })
    }
}));

// Mock moment-timezone
jest.mock('moment-timezone', () => {
    const mockMoment = {
        format: jest.fn().mockReturnValue('2024-01-01T00:00:00.000+0000')
    };
    const momentFn = () => mockMoment;
    momentFn.utc = () => mockMoment;
    return momentFn;
});

const httpContext = require('express-http-context');
const { FhirLoggingManager } = require('../../../../operations/common/fhirLoggingManager');
const { ScopesManager } = require('../../../../operations/security/scopesManager');
const { FhirLogger: fhirLogger } = require('../../../../utils/fhirLogger');

function createMockInstance(ClassRef, methods = {}) {
    const instance = Object.create(ClassRef.prototype);
    Object.assign(instance, methods);
    return instance;
}

describe('FhirLoggingManager', () => {
    let fhirLoggingManager;
    let mockScopesManager;
    let mockLogger;

    beforeEach(() => {
        jest.clearAllMocks();

        mockLogger = {
            info: jest.fn(),
            error: jest.fn()
        };
        fhirLogger.getInSecureLoggerAsync.mockResolvedValue(mockLogger);

        mockScopesManager = createMockInstance(ScopesManager, {
            getAccessCodesFromScopes: jest.fn().mockReturnValue(['bwell']),
            parseScopes: jest.fn().mockReturnValue(['user/*.read'])
        });

        fhirLoggingManager = new FhirLoggingManager({
            scopesManager: mockScopesManager,
            imageVersion: '1.0.0'
        });
    });

    function createRequestInfo(overrides = {}) {
        return {
            user: 'test-user',
            scope: 'user/*.read',
            requestId: 'req-123',
            userRequestId: 'user-req-456',
            remoteIpAddress: '127.0.0.1',
            originalUrl: '/Patient',
            ...overrides
        };
    }

    describe('logOperationSuccessAsync', () => {
        test('should log successful operation with info level', async () => {
            await fhirLoggingManager.logOperationSuccessAsync({
                requestInfo: createRequestInfo(),
                args: { id: 'patient-1' },
                resourceType: 'Patient',
                startTime: Date.now() - 100,
                action: 'search'
            });

            expect(mockLogger.info).toHaveBeenCalledWith(
                expect.objectContaining({
                    outcome: 0,
                    outcomeDesc: 'Success',
                    message: 'operationCompleted'
                })
            );
        });

        test('should include duration in detail when startTime and stopTime are provided', async () => {
            const startTime = 1000;
            const stopTime = 1500;

            await fhirLoggingManager.logOperationSuccessAsync({
                requestInfo: createRequestInfo(),
                args: {},
                resourceType: 'Patient',
                startTime,
                stopTime,
                action: 'read'
            });

            const logEntry = mockLogger.info.mock.calls[0][0];
            const durationDetail = logEntry.entity[0].detail.find(d => d.type === 'duration');
            expect(durationDetail).toBeDefined();
            expect(durationDetail.valuePositiveInt).toBe(500);
        });

        test('should strip resource from args for security (PHI protection)', async () => {
            await fhirLoggingManager.logOperationSuccessAsync({
                requestInfo: createRequestInfo(),
                args: { id: 'patient-1', resource: { name: 'John Doe', ssn: '123-45-6789' } },
                resourceType: 'Patient',
                startTime: Date.now(),
                action: 'create'
            });

            const logEntry = mockLogger.info.mock.calls[0][0];
            const detailTypes = logEntry.entity[0].detail.map(d => d.type);
            expect(detailTypes).not.toContain('resource');
            expect(detailTypes).toContain('id');
        });
    });

    describe('logOperationFailureAsync', () => {
        test('should log with error level when error is present', async () => {
            const error = new Error('Something went wrong');

            await fhirLoggingManager.logOperationFailureAsync({
                requestInfo: createRequestInfo(),
                args: {},
                resourceType: 'Patient',
                startTime: Date.now(),
                action: 'search',
                error
            });

            expect(mockLogger.error).toHaveBeenCalledWith(
                expect.objectContaining({
                    outcome: 8,
                    outcomeDesc: 'Error'
                })
            );
        });

        test('should include error message, constructor name, and stack in message', async () => {
            const error = new Error('Database timeout');

            await fhirLoggingManager.logOperationFailureAsync({
                requestInfo: createRequestInfo(),
                args: {},
                resourceType: 'Patient',
                startTime: Date.now(),
                action: 'search',
                error
            });

            const logEntry = mockLogger.error.mock.calls[0][0];
            expect(logEntry.message).toContain('operationFailed');
            expect(logEntry.message).toContain('Database timeout');
            expect(logEntry.message).toContain('Error');
        });

        test('should use info level when error.logLevel is info', async () => {
            const error = new Error('Not found');
            error.logLevel = 'info';

            await fhirLoggingManager.logOperationFailureAsync({
                requestInfo: createRequestInfo(),
                args: {},
                resourceType: 'Patient',
                startTime: Date.now(),
                action: 'search',
                error
            });

            expect(mockLogger.info).toHaveBeenCalled();
            expect(mockLogger.error).not.toHaveBeenCalled();
        });
    });

    describe('logOperationStartAsync', () => {
        test('should log operation start with stopTime equal to startTime', async () => {
            const startTime = Date.now();

            await fhirLoggingManager.logOperationStartAsync({
                requestInfo: createRequestInfo(),
                args: {},
                resourceType: 'Patient',
                startTime,
                action: 'search'
            });

            const logEntry = mockLogger.info.mock.calls[0][0];
            expect(logEntry.message).toBe('operationStarted');
            // duration should be 0 since stopTime = startTime
            const durationDetail = logEntry.entity[0].detail.find(d => d.type === 'duration');
            expect(durationDetail.valuePositiveInt).toBe(0);
        });
    });

    describe('internalLogOperationAsync edge cases', () => {
        test('BUG: when scope is null, getAccessCodesFromScopes is not called but firstAccessCode stays null', async () => {
            await fhirLoggingManager.logOperationSuccessAsync({
                requestInfo: createRequestInfo({ scope: null }),
                args: {},
                resourceType: 'Patient',
                startTime: Date.now(),
                action: 'read'
            });

            const logEntry = mockLogger.info.mock.calls[0][0];
            // agent.type.text should be null when scope is null
            expect(logEntry.agent[0].type.text).toBeNull();
            expect(mockScopesManager.getAccessCodesFromScopes).not.toHaveBeenCalled();
        });

        test('should handle user as object with name property', async () => {
            await fhirLoggingManager.logOperationSuccessAsync({
                requestInfo: createRequestInfo({ user: { name: 'Dr. Smith', id: 'user-789' } }),
                args: {},
                resourceType: 'Patient',
                startTime: Date.now(),
                action: 'read'
            });

            const logEntry = mockLogger.info.mock.calls[0][0];
            expect(logEntry.agent[0].altId).toBe('Dr. Smith');
        });

        test('should handle user as object with only id property', async () => {
            await fhirLoggingManager.logOperationSuccessAsync({
                requestInfo: createRequestInfo({ user: { id: 'user-789' } }),
                args: {},
                resourceType: 'Patient',
                startTime: Date.now(),
                action: 'read'
            });

            const logEntry = mockLogger.info.mock.calls[0][0];
            expect(logEntry.agent[0].altId).toBe('user-789');
        });

        test('BUG: when startTime is null/0, period.start produces Invalid Date ISO string', async () => {
            await fhirLoggingManager.logOperationSuccessAsync({
                requestInfo: createRequestInfo(),
                args: {},
                resourceType: 'Patient',
                startTime: null,
                action: 'read'
            });

            const logEntry = mockLogger.info.mock.calls[0][0];
            // new Date(null).toISOString() = '1970-01-01T00:00:00.000Z' (not invalid, but wrong)
            // The duration check `if (startTime && stopTime)` will be false so no duration
            const durationDetail = logEntry.entity[0].detail.find(d => d.type === 'duration');
            expect(durationDetail).toBeUndefined();
            // But period.start is still computed from null which gives epoch
            expect(logEntry.period.start).toBe('1970-01-01T00:00:00.000Z');
        });

        test('BUG: when startTime is 0, period uses epoch dates without guard', async () => {
            // startTime = 0 is falsy, so duration won't be calculated
            // But period.start = new Date(0).toISOString() is always computed
            await fhirLoggingManager.logOperationSuccessAsync({
                requestInfo: createRequestInfo(),
                args: {},
                resourceType: 'Patient',
                startTime: 0,
                action: 'read'
            });

            const logEntry = mockLogger.info.mock.calls[0][0];
            expect(logEntry.period.start).toBe('1970-01-01T00:00:00.000Z');
        });

        test('should handle wildcard access code by replacing with bwell', async () => {
            mockScopesManager.getAccessCodesFromScopes.mockReturnValue(['*']);

            await fhirLoggingManager.logOperationSuccessAsync({
                requestInfo: createRequestInfo(),
                args: {},
                resourceType: 'Patient',
                startTime: Date.now(),
                action: 'read'
            });

            const logEntry = mockLogger.info.mock.calls[0][0];
            expect(logEntry.agent[0].type.text).toBe('bwell');
        });

        test('should handle empty access codes array', async () => {
            mockScopesManager.getAccessCodesFromScopes.mockReturnValue([]);

            await fhirLoggingManager.logOperationSuccessAsync({
                requestInfo: createRequestInfo(),
                args: {},
                resourceType: 'Patient',
                startTime: Date.now(),
                action: 'read'
            });

            const logEntry = mockLogger.info.mock.calls[0][0];
            expect(logEntry.agent[0].type.text).toBeNull();
        });

        test('should include request IDs from httpContext', async () => {
            httpContext.get.mockImplementation((key) => {
                if (key === 'userRequestId') return 'ctx-user-req-id';
                if (key === 'systemGeneratedRequestId') return 'ctx-sys-req-id';
                return undefined;
            });

            await fhirLoggingManager.logOperationSuccessAsync({
                requestInfo: createRequestInfo(),
                args: {},
                resourceType: 'Patient',
                startTime: Date.now(),
                action: 'read'
            });

            const logEntry = mockLogger.info.mock.calls[0][0];
            expect(logEntry.request.id).toBe('ctx-user-req-id');
            expect(logEntry.request.systemGeneratedRequestId).toBe('ctx-sys-req-id');
        });

        test('BUG: error with null message still attempts string concatenation', async () => {
            const error = new Error();
            error.message = '';
            // error.message is empty string which is falsy but constructor.name will still be appended

            await fhirLoggingManager.logOperationFailureAsync({
                requestInfo: createRequestInfo(),
                args: {},
                resourceType: 'Patient',
                startTime: Date.now(),
                action: 'read',
                error
            });

            const logEntry = mockLogger.error.mock.calls[0][0];
            // message will be 'operationFailed: : Error: <stack>'
            // Note the ': :' pattern due to empty message - cosmetic bug
            expect(logEntry.message).toContain('operationFailed');
            expect(logEntry.message).toContain('Error');
        });

        test('should handle args with circular references via getCircularReplacer', async () => {
            const circularObj = {};
            circularObj.self = circularObj;

            // This should not throw
            await fhirLoggingManager.logOperationSuccessAsync({
                requestInfo: createRequestInfo(),
                args: { circular: circularObj },
                resourceType: 'Patient',
                startTime: Date.now(),
                action: 'read'
            });

            expect(mockLogger.info).toHaveBeenCalled();
        });

        test('BUG: negative duration when stopTime < startTime is stored as valuePositiveInt', async () => {
            // The field is typed as valuePositiveInt but no validation prevents negative values
            const startTime = 2000;
            const stopTime = 1000;

            await fhirLoggingManager.internalLogOperationAsync({
                requestInfo: createRequestInfo(),
                args: {},
                resourceType: 'Patient',
                startTime,
                stopTime,
                message: 'test',
                action: 'read'
            });

            const logEntry = mockLogger.info.mock.calls[0][0];
            const durationDetail = logEntry.entity[0].detail.find(d => d.type === 'duration');
            // This is a bug: valuePositiveInt should not be negative
            expect(durationDetail.valuePositiveInt).toBe(-1000);
        });
    });

    describe('constructor', () => {
        test('should throw if scopesManager is wrong type', () => {
            expect(() => new FhirLoggingManager({
                scopesManager: {},
                imageVersion: '1.0.0'
            })).toThrow();
        });

        test('should accept null imageVersion', () => {
            const manager = new FhirLoggingManager({
                scopesManager: mockScopesManager,
                imageVersion: null
            });
            expect(manager.imageVersion).toBeNull();
        });
    });
});
