const { describe, test, expect, beforeEach, jest } = require('@jest/globals');

// Mock modules
jest.mock('express-http-context', () => ({
    get: jest.fn(),
    set: jest.fn()
}));

jest.mock('compression', () => jest.fn(() => (req, res, next) => next()));
jest.mock('helmet', () => jest.fn(() => (req, res, next) => next()));
jest.mock('passport', () => ({
    use: jest.fn()
}));
jest.mock('content-type', () => ({
    parse: jest.fn((ct) => ({ type: ct }))
}));

// Mock deep dependencies that cause import chain issues
jest.mock('../../../middleware/fhir/router', () => {
    class FhirRouter {
        constructor(params) {}
        setRoutes(options) {}
    }
    return { FhirRouter };
});

jest.mock('../../../middleware/fhir/utils/schema.utils', () => ({
    resolveSchema: jest.fn(),
    isValidVersion: jest.fn()
}));

jest.mock('../../../utils/convertErrorToOperationOutcome', () => ({
    convertErrorToOperationOutcome: jest.fn()
}));

jest.mock('../../../operations/common/logging', () => ({
    logError: jest.fn()
}));

jest.mock('../../../utils/fhirRequestInfoBuilder', () => ({
    FhirRequestInfoBuilder: {
        fromRequest: jest.fn().mockReturnValue({})
    }
}));

jest.mock('../../../utils/configManager', () => {
    class ConfigManager {
        get payloadLimit() { return '50mb'; }
        get enableAccessAuditEvent() { return false; }
    }
    return { ConfigManager };
});

const { MyFHIRServer } = require('../../../routeHandlers/fhirServer');
const { FhirRouter } = require('../../../middleware/fhir/router');
const { ConfigManager } = require('../../../utils/configManager');
const { isValidVersion, resolveSchema } = require('../../../middleware/fhir/utils/schema.utils');
const { convertErrorToOperationOutcome } = require('../../../utils/convertErrorToOperationOutcome');
const httpContext = require('express-http-context');

describe('MyFHIRServer', () => {
    let server;
    let mockApp;
    let mockContainer;
    let mockFhirRouter;
    let mockConfigManager;

    beforeEach(() => {
        jest.clearAllMocks();

        mockFhirRouter = Object.create(FhirRouter.prototype);
        mockFhirRouter.setRoutes = jest.fn();

        mockConfigManager = Object.create(ConfigManager.prototype);
        Object.defineProperty(mockConfigManager, 'payloadLimit', { get: () => '50mb', configurable: true });
        Object.defineProperty(mockConfigManager, 'enableAccessAuditEvent', { get: () => false, configurable: true });

        mockContainer = {
            fhirRouter: mockFhirRouter,
            configManager: mockConfigManager
        };

        mockApp = {
            use: jest.fn(),
            options: jest.fn(),
            get: jest.fn(),
            post: jest.fn()
        };

        // Mock express() since we pass app
        server = new MyFHIRServer(
            () => mockContainer,
            { server: {} },
            mockApp
        );
    });

    describe('constructor', () => {
        test('should set config properly', () => {
            expect(server.config).toEqual({ server: {} });
        });

        test('should use provided app', () => {
            expect(server.app).toBe(mockApp);
        });

        test('should set env.USE_HTTPS to undefined when no ssl config', () => {
            expect(server.env.USE_HTTPS).toBeUndefined();
        });

        test('should set env.USE_HTTPS when ssl config is provided', () => {
            const sslConfig = { ssl: { key: 'key', cert: 'cert' } };
            const sslServer = new MyFHIRServer(
                () => mockContainer,
                { server: sslConfig },
                mockApp
            );
            expect(sslServer.env.USE_HTTPS).toEqual(sslConfig.ssl);
        });

        test('should return self for chaining', () => {
            const result = new MyFHIRServer(
                () => mockContainer,
                { server: {} },
                mockApp
            );
            expect(result).toBeInstanceOf(MyFHIRServer);
        });
    });

    describe('configureMiddleware', () => {
        test('should register middleware and return self for chaining', () => {
            const result = server.configureMiddleware();
            expect(result).toBe(server);
            expect(mockApp.use).toHaveBeenCalled();
        });
    });

    describe('configureHelmet', () => {
        test('should return self for chaining', () => {
            const result = server.configureHelmet();
            expect(result).toBe(server);
            expect(mockApp.use).toHaveBeenCalled();
        });
    });

    describe('configureSession', () => {
        test('should return self when no session', () => {
            const result = server.configureSession();
            expect(result).toBe(server);
        });

        test('should use session middleware when provided', () => {
            const mockSession = (req, res, next) => next();
            server.configureSession(mockSession);
            expect(mockApp.use).toHaveBeenCalledWith(mockSession);
        });
    });

    describe('configurePassport', () => {
        test('should return self when no auth config', () => {
            const result = server.configurePassport();
            expect(result).toBe(server);
        });
    });

    describe('setPublicDirectory', () => {
        test('should return self when no public directory', () => {
            const result = server.setPublicDirectory();
            expect(result).toBe(server);
        });
    });

    describe('setProfileRoutes', () => {
        test('should call fhirRouter.setRoutes and return self', () => {
            const result = server.setProfileRoutes();
            expect(mockFhirRouter.setRoutes).toHaveBeenCalledWith(server);
            expect(result).toBe(server);
        });
    });

    describe('setErrorRoutes', () => {
        let errorHandler;
        let notFoundHandler;

        beforeEach(() => {
            server.setErrorRoutes();
            // The error handler is the first call to app.use, the not-found is the second
            const useCalls = mockApp.use.mock.calls;
            errorHandler = useCalls[0][0];
            notFoundHandler = useCalls[1][0];
        });

        describe('error handler (fhirErrorHandler)', () => {
            test('should return 404 JSON when base version is invalid', () => {
                isValidVersion.mockReturnValue(false);

                const req = { url: '/invalid_version/Patient' };
                const res = {
                    status: jest.fn().mockReturnThis(),
                    json: jest.fn().mockReturnThis(),
                    end: jest.fn(),
                    headersSent: false
                };
                const next = jest.fn();
                const err = new Error('some error');

                errorHandler(err, req, res, next);

                expect(res.status).toHaveBeenCalledWith(404);
                expect(res.json).toHaveBeenCalledWith({});
            });

            test('should call res.end when headers already sent', () => {
                isValidVersion.mockReturnValue(true);
                resolveSchema.mockReturnValue(class OperationOutcome {
                    static get resourceType() { return 'OperationOutcome'; }
                });

                const req = { url: '/4_0_0/Patient', id: 'req-123' };
                const res = {
                    status: jest.fn().mockReturnThis(),
                    json: jest.fn().mockReturnThis(),
                    end: jest.fn(),
                    setHeader: jest.fn(),
                    headersSent: true
                };
                const next = jest.fn();
                const err = new Error('some error');

                errorHandler(err, req, res, next);

                expect(res.end).toHaveBeenCalled();
                expect(res.status).not.toHaveBeenCalled();
            });

            test('should set X-Request-ID header from httpContext when req.id exists', () => {
                isValidVersion.mockReturnValue(true);
                const MockOO = function(params) { return { ...params, resourceType: 'OperationOutcome' }; };
                MockOO.resourceType = 'OperationOutcome';
                resolveSchema.mockReturnValue(MockOO);
                convertErrorToOperationOutcome.mockReturnValue({ resourceType: 'OperationOutcome', issue: [] });
                httpContext.get.mockReturnValue('user-request-id-123');

                const req = { url: '/4_0_0/Patient', id: 'req-123' };
                const res = {
                    status: jest.fn().mockReturnThis(),
                    json: jest.fn().mockReturnThis(),
                    end: jest.fn(),
                    setHeader: jest.fn(),
                    headersSent: false
                };
                const next = jest.fn();
                const err = new Error('some error');
                err.statusCode = 400;

                errorHandler(err, req, res, next);

                expect(res.setHeader).toHaveBeenCalledWith('X-Request-ID', 'user-request-id-123');
            });

            test('should handle OperationOutcome error with statusCode', () => {
                isValidVersion.mockReturnValue(true);
                const MockOO = function(params) { return { ...params, resourceType: 'OperationOutcome' }; };
                MockOO.resourceType = 'OperationOutcome';
                resolveSchema.mockReturnValue(MockOO);

                const req = { url: '/4_0_0/Patient' };
                const res = {
                    status: jest.fn().mockReturnThis(),
                    json: jest.fn().mockReturnThis(),
                    end: jest.fn(),
                    setHeader: jest.fn(),
                    headersSent: false
                };
                const next = jest.fn();
                const err = {
                    resourceType: 'OperationOutcome',
                    statusCode: 422,
                    message: 'Unprocessable'
                };

                errorHandler(err, req, res, next);

                expect(res.status).toHaveBeenCalledWith(422);
                expect(res.json).toHaveBeenCalledWith(err);
            });

            test('should default to 500 when OperationOutcome error has no statusCode', () => {
                isValidVersion.mockReturnValue(true);
                const MockOO = function(params) { return { ...params, resourceType: 'OperationOutcome' }; };
                MockOO.resourceType = 'OperationOutcome';
                resolveSchema.mockReturnValue(MockOO);
                convertErrorToOperationOutcome.mockReturnValue({ resourceType: 'OperationOutcome', issue: [] });

                const req = { url: '/4_0_0/Patient' };
                const res = {
                    status: jest.fn().mockReturnThis(),
                    json: jest.fn().mockReturnThis(),
                    end: jest.fn(),
                    setHeader: jest.fn(),
                    headersSent: false
                };
                const next = jest.fn();
                const err = {
                    resourceType: 'OperationOutcome',
                    message: 'Internal error'
                    // no statusCode
                };

                errorHandler(err, req, res, next);

                expect(res.status).toHaveBeenCalledWith(500);
                // Should convert to internal error (hide details)
                expect(convertErrorToOperationOutcome).toHaveBeenCalledWith({ error: err, internalError: true });
            });

            test('should handle generic error (non-OperationOutcome)', () => {
                isValidVersion.mockReturnValue(true);
                const MockOO = function(params) { return { ...params, resourceType: 'OperationOutcome' }; };
                MockOO.resourceType = 'OperationOutcome';
                resolveSchema.mockReturnValue(MockOO);
                const mockOutcome = { resourceType: 'OperationOutcome', issue: [] };
                convertErrorToOperationOutcome.mockReturnValue(mockOutcome);

                const req = { url: '/4_0_0/Patient' };
                const res = {
                    status: jest.fn().mockReturnThis(),
                    json: jest.fn().mockReturnThis(),
                    end: jest.fn(),
                    setHeader: jest.fn(),
                    headersSent: false
                };
                const next = jest.fn();
                const err = new Error('generic error');
                err.statusCode = 403;

                errorHandler(err, req, res, next);

                expect(res.status).toHaveBeenCalledWith(403);
                expect(convertErrorToOperationOutcome).toHaveBeenCalledWith({
                    error: err,
                    internalError: false
                });
            });

            test('should call next() when err is null/falsy', () => {
                isValidVersion.mockReturnValue(true);
                const MockOO = function(params) { return { ...params, resourceType: 'OperationOutcome' }; };
                MockOO.resourceType = 'OperationOutcome';
                resolveSchema.mockReturnValue(MockOO);

                const req = { url: '/4_0_0/Patient' };
                const res = {
                    status: jest.fn().mockReturnThis(),
                    json: jest.fn().mockReturnThis(),
                    end: jest.fn(),
                    setHeader: jest.fn(),
                    headersSent: false
                };
                const next = jest.fn();

                errorHandler(null, req, res, next);

                expect(next).toHaveBeenCalled();
            });

            test('should handle error in error handler itself (catch block)', () => {
                isValidVersion.mockReturnValue(true);
                // Make resolveSchema throw on first call to trigger catch block
                resolveSchema.mockImplementationOnce(() => {
                    throw new Error('Schema resolution failed');
                });
                // Second call (in catch) returns a valid constructor
                const MockOO = function(params) { return { ...params }; };
                resolveSchema.mockReturnValue(MockOO);

                const req = { url: '/4_0_0/Patient' };
                const res = {
                    status: jest.fn().mockReturnThis(),
                    json: jest.fn().mockReturnThis(),
                    end: jest.fn(),
                    setHeader: jest.fn(),
                    headersSent: false
                };
                const next = jest.fn();
                const err = new Error('some error');

                errorHandler(err, req, res, next);

                expect(res.status).toHaveBeenCalledWith(500);
            });

            test('BUG: should handle req.url being empty string - split gives empty first element', () => {
                // When req.url is '', split('/')[1] returns undefined
                // isValidVersion(undefined) returns false, so it returns 404
                isValidVersion.mockReturnValue(false);

                const req = { url: '' };
                const res = {
                    status: jest.fn().mockReturnThis(),
                    json: jest.fn().mockReturnThis(),
                    end: jest.fn(),
                    headersSent: false
                };
                const next = jest.fn();
                const err = new Error('error');

                errorHandler(err, req, res, next);

                expect(res.status).toHaveBeenCalledWith(404);
            });

            test('BUG: X-Request-ID uses httpContext.get which could return null', () => {
                isValidVersion.mockReturnValue(true);
                const MockOO = function(params) { return { ...params, resourceType: 'OperationOutcome' }; };
                MockOO.resourceType = 'OperationOutcome';
                resolveSchema.mockReturnValue(MockOO);
                convertErrorToOperationOutcome.mockReturnValue({ issue: [] });
                // httpContext.get returns null
                httpContext.get.mockReturnValue(null);

                const req = { url: '/4_0_0/Patient', id: 'req-1' };
                const res = {
                    status: jest.fn().mockReturnThis(),
                    json: jest.fn().mockReturnThis(),
                    end: jest.fn(),
                    setHeader: jest.fn(),
                    headersSent: false
                };
                const next = jest.fn();
                const err = new Error('test');
                err.statusCode = 400;

                errorHandler(err, req, res, next);

                // String(null) = 'null' -- this could be unexpected for clients
                expect(res.setHeader).toHaveBeenCalledWith('X-Request-ID', 'null');
            });
        });

        describe('not-found handler (fhirNotFoundHandler)', () => {
            test('should return 404 with OperationOutcome', () => {
                const MockOO = function(params) { return { ...params, resourceType: 'OperationOutcome' }; };
                resolveSchema.mockReturnValue(MockOO);

                const req = { url: '/4_0_0/NonExistent', path: '/4_0_0/NonExistent' };
                const res = {
                    status: jest.fn().mockReturnThis(),
                    json: jest.fn().mockReturnThis(),
                    setHeader: jest.fn(),
                    headersSent: false
                };

                notFoundHandler(req, res);

                expect(res.status).toHaveBeenCalledWith(404);
                expect(res.json).toHaveBeenCalled();
            });

            test('should set X-Request-ID when req.id exists and headers not sent', () => {
                const MockOO = function(params) { return { ...params, resourceType: 'OperationOutcome' }; };
                resolveSchema.mockReturnValue(MockOO);
                httpContext.get.mockReturnValue('user-req-id');

                const req = { url: '/4_0_0/Patient', path: '/4_0_0/Patient', id: 'some-id' };
                const res = {
                    status: jest.fn().mockReturnThis(),
                    json: jest.fn().mockReturnThis(),
                    setHeader: jest.fn(),
                    headersSent: false
                };

                notFoundHandler(req, res);

                expect(res.setHeader).toHaveBeenCalledWith('X-Request-ID', 'user-req-id');
            });

            test('should handle empty URL gracefully', () => {
                const MockOO = function(params) { return { ...params, resourceType: 'OperationOutcome' }; };
                resolveSchema.mockReturnValue(MockOO);

                const req = { url: '', path: '' };
                const res = {
                    status: jest.fn().mockReturnThis(),
                    json: jest.fn().mockReturnThis(),
                    setHeader: jest.fn(),
                    headersSent: false
                };

                // url.split('/')[1] is '' when url is '', or undefined when url is '/'
                // The code does: `const base = req.url.split('/')[1] || VERSIONS['4_0_1']`
                notFoundHandler(req, res);

                expect(res.status).toHaveBeenCalledWith(404);
            });

            test('should use R4 OperationOutcome for non-version base paths', () => {
                const MockOO = function(params) { return { ...params, resourceType: 'OperationOutcome' }; };
                resolveSchema.mockReturnValue(MockOO);

                const req = { url: '/unknown/path', path: '/unknown/path' };
                const res = {
                    status: jest.fn().mockReturnThis(),
                    json: jest.fn().mockReturnThis(),
                    setHeader: jest.fn(),
                    headersSent: false
                };

                notFoundHandler(req, res);

                // Should call resolveSchema with '4_0_0' for non-version paths
                expect(resolveSchema).toHaveBeenCalledWith('4_0_0', 'operationoutcome');
            });
        });
    });

    describe('logErrorAuditEvent', () => {
        test('should return early when enableAccessAuditEvent is false', () => {
            const req = { url: '/4_0_0/Patient', authInfo: {} };
            server.logErrorAuditEvent(req, 400, new Error('bad'));
            // Should not throw since it returns early
        });

        test('should log error audit event when enabled', () => {
            Object.defineProperty(mockConfigManager, 'enableAccessAuditEvent', { get: () => true, configurable: true });
            // Re-create server to pick up new config
            const mockAuditLogger = {
                logErrorAuditEntryAsync: jest.fn().mockResolvedValue(undefined)
            };
            mockContainer.auditLogger = mockAuditLogger;

            const newServer = new MyFHIRServer(
                () => mockContainer,
                { server: {} },
                mockApp
            );

            const req = {
                url: '/4_0_0/Patient',
                resourceType: 'Patient',
                authInfo: { scope: 'patient/*.read' }
            };

            newServer.logErrorAuditEvent(req, 403, new Error('Forbidden'));

            expect(mockAuditLogger.logErrorAuditEntryAsync).toHaveBeenCalledWith(
                expect.objectContaining({
                    errorCode: 403,
                    errorMessage: 'Forbidden'
                })
            );
        });

        test('should extract resourceType from URL when not on req object', () => {
            Object.defineProperty(mockConfigManager, 'enableAccessAuditEvent', { get: () => true, configurable: true });
            const mockAuditLogger = {
                logErrorAuditEntryAsync: jest.fn().mockResolvedValue(undefined)
            };
            mockContainer.auditLogger = mockAuditLogger;

            const newServer = new MyFHIRServer(
                () => mockContainer,
                { server: {} },
                mockApp
            );

            const req = {
                url: '/4_0_0/Observation?patient=123',
                authInfo: {}
            };

            newServer.logErrorAuditEvent(req, 500, new Error('Internal'));

            expect(mockAuditLogger.logErrorAuditEntryAsync).toHaveBeenCalledWith(
                expect.objectContaining({
                    resourceType: 'Observation'
                })
            );
        });

        test('should handle error in logErrorAuditEvent gracefully', () => {
            Object.defineProperty(mockConfigManager, 'enableAccessAuditEvent', { get: () => true, configurable: true });
            mockContainer.auditLogger = undefined; // This will cause an error

            const newServer = new MyFHIRServer(
                () => mockContainer,
                { server: {} },
                mockApp
            );

            const req = { url: '/4_0_0/Patient' };

            // Should not throw - caught internally
            expect(() => {
                newServer.logErrorAuditEvent(req, 500, new Error('error'));
            }).not.toThrow();
        });

        test('should include scope in extraParams for 403 errors', () => {
            Object.defineProperty(mockConfigManager, 'enableAccessAuditEvent', { get: () => true, configurable: true });
            const mockAuditLogger = {
                logErrorAuditEntryAsync: jest.fn().mockResolvedValue(undefined)
            };
            mockContainer.auditLogger = mockAuditLogger;

            const newServer = new MyFHIRServer(
                () => mockContainer,
                { server: {} },
                mockApp
            );

            const req = {
                url: '/4_0_0/Patient',
                resourceType: 'Patient',
                authInfo: { scope: 'user/*.read' }
            };

            newServer.logErrorAuditEvent(req, 403, new Error('Forbidden'));

            const call = mockAuditLogger.logErrorAuditEntryAsync.mock.calls[0][0];
            expect(call.extraParams).toEqual([{ type: 'scope', valueString: 'user/*.read' }]);
        });

        test('should use STATUS_CODES for non-403 errors', () => {
            Object.defineProperty(mockConfigManager, 'enableAccessAuditEvent', { get: () => true, configurable: true });
            const mockAuditLogger = {
                logErrorAuditEntryAsync: jest.fn().mockResolvedValue(undefined)
            };
            mockContainer.auditLogger = mockAuditLogger;

            const newServer = new MyFHIRServer(
                () => mockContainer,
                { server: {} },
                mockApp
            );

            const req = {
                url: '/4_0_0/Patient',
                resourceType: 'Patient',
                authInfo: {}
            };

            newServer.logErrorAuditEvent(req, 400, new Error('Bad Request'));

            const call = mockAuditLogger.logErrorAuditEntryAsync.mock.calls[0][0];
            expect(call.errorMessage).toBe('Bad Request');
            expect(call.extraParams).toBeUndefined();
        });

        test('BUG: should handle req.url split failure when URL has no slashes', () => {
            Object.defineProperty(mockConfigManager, 'enableAccessAuditEvent', { get: () => true, configurable: true });
            const mockAuditLogger = {
                logErrorAuditEntryAsync: jest.fn().mockResolvedValue(undefined)
            };
            mockContainer.auditLogger = mockAuditLogger;

            const newServer = new MyFHIRServer(
                () => mockContainer,
                { server: {} },
                mockApp
            );

            // req.url.split('/')[2] would be undefined
            // then undefined?.split('?')[0] uses optional chaining so it's safe
            const req = {
                url: '/',
                authInfo: {}
            };

            expect(() => {
                newServer.logErrorAuditEvent(req, 500, new Error('error'));
            }).not.toThrow();

            const call = mockAuditLogger.logErrorAuditEntryAsync.mock.calls[0][0];
            expect(call.resourceType).toBeNull(); // resourceType falls through to null
        });
    });
});
