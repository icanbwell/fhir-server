const { describe, test, expect, beforeEach, jest } = require('@jest/globals');

// Mock express-http-context
jest.mock('express-http-context', () => ({
    get: jest.fn(),
    set: jest.fn()
}));

// Mock the logging module to avoid Winston initialization
jest.mock('../../../operations/common/logging', () => ({
    logError: jest.fn(),
    logInfo: jest.fn()
}));

const httpContext = require('express-http-context');
const { FhirRequestInfoBuilder } = require('../../../utils/fhirRequestInfoBuilder');
const { FhirRequestInfo } = require('../../../utils/fhirRequestInfo');
const { REQUEST_ID_TYPE } = require('../../../constants');

/**
 * Creates a minimal mock request object
 */
function createMockRequest(overrides = {}) {
    return {
        headers: { 'content-type': 'application/json', host: 'localhost:3000', ...overrides.headers },
        hostname: overrides.hostname || 'localhost',
        protocol: overrides.protocol || 'http',
        originalUrl: overrides.originalUrl || '/Patient',
        path: overrides.path || '/Patient',
        method: overrides.method || 'GET',
        body: overrides.body || null,
        socket: { remoteAddress: overrides.remoteAddress || '127.0.0.1' },
        authInfo: overrides.authInfo || undefined,
        user: overrides.user || undefined,
        requestId: overrides.requestId || 'req-123',
        userRequestId: overrides.userRequestId || 'user-req-456',
        ...overrides
    };
}

describe('FhirRequestInfoBuilder', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        httpContext.get.mockReturnValue(undefined);
    });

    describe('constructor', () => {
        test('should create instance with valid request', () => {
            const req = createMockRequest();
            const builder = new FhirRequestInfoBuilder(req);
            expect(builder.req).toBe(req);
        });

        test('should throw if req is null', () => {
            expect(() => new FhirRequestInfoBuilder(null)).toThrow();
        });

        test('should throw if req is undefined', () => {
            expect(() => new FhirRequestInfoBuilder(undefined)).toThrow();
        });
    });

    describe('fromRequest (static factory)', () => {
        test('should return a FhirRequestInfo instance', () => {
            const req = createMockRequest();
            const result = FhirRequestInfoBuilder.fromRequest(req);
            expect(result).toBeInstanceOf(FhirRequestInfo);
        });

        test('should throw for null request', () => {
            expect(() => FhirRequestInfoBuilder.fromRequest(null)).toThrow();
        });
    });

    describe('extractUser', () => {
        test('should return personId for patient-scoped tokens (isUser=true)', () => {
            const req = createMockRequest({
                authInfo: {
                    scope: 'patient/*.read',
                    context: {
                        isUser: true,
                        personIdFromJwtToken: 'person-123',
                        username: 'should-not-be-used'
                    }
                }
            });
            const builder = new FhirRequestInfoBuilder(req);
            const result = builder.build();
            expect(result.user).toBe('person-123');
        });

        test('should return username when isUser is false', () => {
            const req = createMockRequest({
                authInfo: {
                    scope: 'system/*.read',
                    context: {
                        isUser: false,
                        username: 'admin-user'
                    }
                }
            });
            const builder = new FhirRequestInfoBuilder(req);
            const result = builder.build();
            expect(result.user).toBe('admin-user');
        });

        test('should return subject when username is not present', () => {
            const req = createMockRequest({
                authInfo: {
                    scope: 'system/*.read',
                    context: {
                        isUser: false,
                        subject: 'subject-abc'
                    }
                }
            });
            const builder = new FhirRequestInfoBuilder(req);
            const result = builder.build();
            expect(result.user).toBe('subject-abc');
        });

        test('should return req.user as string if it is a string', () => {
            const req = createMockRequest({
                user: 'string-user',
                authInfo: { scope: 'system/*.read', context: {} }
            });
            const builder = new FhirRequestInfoBuilder(req);
            const result = builder.build();
            expect(result.user).toBe('string-user');
        });

        test('should return req.user.name when user is an object', () => {
            const req = createMockRequest({
                user: { name: 'object-user-name', id: 'object-user-id' },
                authInfo: { scope: 'system/*.read', context: {} }
            });
            const builder = new FhirRequestInfoBuilder(req);
            const result = builder.build();
            expect(result.user).toBe('object-user-name');
        });

        test('should return req.user.id when user is an object without name', () => {
            const req = createMockRequest({
                user: { id: 'object-user-id' },
                authInfo: { scope: 'system/*.read', context: {} }
            });
            const builder = new FhirRequestInfoBuilder(req);
            const result = builder.build();
            expect(result.user).toBe('object-user-id');
        });

        test('should return null/undefined when no user info available', () => {
            const req = createMockRequest({
                authInfo: { scope: 'system/*.read', context: {} },
                user: undefined
            });
            const builder = new FhirRequestInfoBuilder(req);
            const result = builder.build();
            expect(result.user).toBeFalsy();
        });

        test('should handle isUser=true but no personId gracefully', () => {
            const req = createMockRequest({
                authInfo: {
                    scope: 'patient/*.read',
                    context: {
                        isUser: true,
                        personIdFromJwtToken: undefined,
                        username: 'fallback-user'
                    }
                }
            });
            const builder = new FhirRequestInfoBuilder(req);
            const result = builder.build();
            // When isUser is true but personId is undefined, should fall through to username
            expect(result.user).toBe('fallback-user');
        });
    });

    describe('extractHost', () => {
        test('should return hostname without port for https', () => {
            const req = createMockRequest({
                protocol: 'https',
                hostname: 'api.example.com',
                headers: { host: 'api.example.com:443', 'content-type': 'application/json' }
            });
            const builder = new FhirRequestInfoBuilder(req);
            const result = builder.build();
            expect(result.host).toBe('api.example.com');
        });

        test('should include port for non-https protocol', () => {
            const req = createMockRequest({
                protocol: 'http',
                hostname: 'localhost',
                headers: { host: 'localhost:3000', 'content-type': 'application/json' }
            });
            const builder = new FhirRequestInfoBuilder(req);
            const result = builder.build();
            expect(result.host).toBe('localhost:3000');
        });

        test('should not include port if not present in host header', () => {
            const req = createMockRequest({
                protocol: 'http',
                hostname: 'localhost',
                headers: { host: 'localhost', 'content-type': 'application/json' }
            });
            const builder = new FhirRequestInfoBuilder(req);
            const result = builder.build();
            expect(result.host).toBe('localhost');
        });

        test('should handle missing host header gracefully', () => {
            const req = createMockRequest({
                protocol: 'http',
                hostname: 'localhost',
                headers: { 'content-type': 'application/json' }
            });
            // Remove host header
            delete req.headers.host;
            const builder = new FhirRequestInfoBuilder(req);
            const result = builder.build();
            expect(result.host).toBe('localhost');
        });

        test('should handle malformed host header without crashing', () => {
            const req = createMockRequest({
                protocol: 'http',
                hostname: 'localhost',
                headers: { host: '://invalid::', 'content-type': 'application/json' }
            });
            const builder = new FhirRequestInfoBuilder(req);
            // Should not throw — the error is caught internally
            const result = builder.build();
            expect(result.host).toBe('localhost');
        });
    });

    describe('alternateUserId', () => {
        test('should return subject for patient-scoped tokens', () => {
            const req = createMockRequest({
                authInfo: {
                    scope: 'patient/*.read',
                    context: {
                        isUser: true,
                        personIdFromJwtToken: 'person-1',
                        subject: 'sub-from-token'
                    }
                }
            });
            const builder = new FhirRequestInfoBuilder(req);
            const result = builder.build();
            expect(result.alternateUserId).toBe('sub-from-token');
        });

        test('should return same as user for non-patient tokens', () => {
            const req = createMockRequest({
                authInfo: {
                    scope: 'system/*.read',
                    context: {
                        isUser: false,
                        username: 'admin'
                    }
                }
            });
            const builder = new FhirRequestInfoBuilder(req);
            const result = builder.build();
            expect(result.alternateUserId).toBe('admin');
        });
    });

    describe('build', () => {
        test('should use httpContext requestId when available', () => {
            httpContext.get.mockImplementation((key) => {
                if (key === REQUEST_ID_TYPE.SYSTEM_GENERATED_REQUEST_ID) return 'ctx-sys-req-id';
                if (key === REQUEST_ID_TYPE.USER_REQUEST_ID) return 'ctx-user-req-id';
                return undefined;
            });

            const req = createMockRequest({
                requestId: 'fallback-req-id',
                authInfo: { scope: 'system/*.read', context: {} }
            });
            const builder = new FhirRequestInfoBuilder(req);
            const result = builder.build();
            expect(result.requestId).toBe('ctx-sys-req-id');
            expect(result.userRequestId).toBe('ctx-user-req-id');
        });

        test('should fallback to req.requestId when httpContext returns undefined', () => {
            httpContext.get.mockReturnValue(undefined);

            const req = createMockRequest({
                requestId: 'fallback-req-id',
                userRequestId: 'fallback-user-req-id',
                authInfo: { scope: 'system/*.read', context: {} }
            });
            const builder = new FhirRequestInfoBuilder(req);
            const result = builder.build();
            expect(result.requestId).toBe('fallback-req-id');
            expect(result.userRequestId).toBe('fallback-user-req-id');
        });

        test('should handle missing content-type header', () => {
            const req = createMockRequest({
                authInfo: { scope: 'system/*.read', context: {} }
            });
            delete req.headers['content-type'];
            const builder = new FhirRequestInfoBuilder(req);
            const result = builder.build();
            expect(result.contentTypeFromHeader).toBeNull();
        });

        test('should parse content-type header correctly', () => {
            const req = createMockRequest({
                headers: { 'content-type': 'application/fhir+json; charset=utf-8', host: 'localhost:3000' },
                authInfo: { scope: 'system/*.read', context: {} }
            });
            const builder = new FhirRequestInfoBuilder(req);
            const result = builder.build();
            expect(result.contentTypeFromHeader.type).toBe('application/fhir+json');
        });

        test('should allow overrides in build()', () => {
            const req = createMockRequest({
                authInfo: { scope: 'system/*.read', context: {} }
            });
            const builder = new FhirRequestInfoBuilder(req);
            const result = builder.build({ user: 'override-user', requestId: 'override-req' });
            expect(result.user).toBe('override-user');
            expect(result.requestId).toBe('override-req');
        });

        test('should extract remoteIpAddress from socket', () => {
            const req = createMockRequest({
                remoteAddress: '192.168.1.100',
                authInfo: { scope: 'system/*.read', context: {} }
            });
            const builder = new FhirRequestInfoBuilder(req);
            const result = builder.build();
            expect(result.remoteIpAddress).toBe('192.168.1.100');
        });

        test('BUG: crashes if req.socket is null/undefined', () => {
            const req = createMockRequest({
                authInfo: { scope: 'system/*.read', context: {} }
            });
            req.socket = null;
            const builder = new FhirRequestInfoBuilder(req);
            // Accessing req.socket.remoteAddress when socket is null will throw TypeError
            expect(() => builder.build()).toThrow();
        });

        test('should handle authInfo being undefined', () => {
            const req = createMockRequest({
                authInfo: undefined
            });
            const builder = new FhirRequestInfoBuilder(req);
            const result = builder.build();
            expect(result.scope).toBeUndefined();
            expect(result.isUser).toBeUndefined();
        });

        test('should handle authInfo.context being undefined', () => {
            const req = createMockRequest({
                authInfo: { scope: 'system/*.read' }
            });
            const builder = new FhirRequestInfoBuilder(req);
            const result = builder.build();
            expect(result.isUser).toBeUndefined();
            expect(result.personIdFromJwtToken).toBeUndefined();
        });
    });

    describe('data isolation / caching concerns', () => {
        test('should not share state between builder instances', () => {
            const req1 = createMockRequest({
                authInfo: { scope: 'patient/*.read', context: { isUser: true, personIdFromJwtToken: 'person-A' } }
            });
            const req2 = createMockRequest({
                authInfo: { scope: 'system/*.write', context: { isUser: false, username: 'admin-B' } }
            });

            const result1 = FhirRequestInfoBuilder.fromRequest(req1);
            const result2 = FhirRequestInfoBuilder.fromRequest(req2);

            expect(result1.user).toBe('person-A');
            expect(result2.user).toBe('admin-B');
        });

        test('httpContext values are request-scoped (different calls get different values)', () => {
            // First request
            httpContext.get.mockImplementation((key) => {
                if (key === REQUEST_ID_TYPE.SYSTEM_GENERATED_REQUEST_ID) return 'req-1';
                return undefined;
            });

            const req1 = createMockRequest({ authInfo: { scope: 's', context: {} } });
            const result1 = FhirRequestInfoBuilder.fromRequest(req1);

            // Second request (different context)
            httpContext.get.mockImplementation((key) => {
                if (key === REQUEST_ID_TYPE.SYSTEM_GENERATED_REQUEST_ID) return 'req-2';
                return undefined;
            });

            const req2 = createMockRequest({ authInfo: { scope: 's', context: {} } });
            const result2 = FhirRequestInfoBuilder.fromRequest(req2);

            expect(result1.requestId).toBe('req-1');
            expect(result2.requestId).toBe('req-2');
        });
    });
});
