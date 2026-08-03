const { describe, test, expect, beforeEach, jest: jestObj } = require('@jest/globals');

// Mock passport-jwt
jestObj.mock('passport-jwt', () => {
    const { jest: j } = require('@jest/globals');
    class Strategy {
        constructor (options, verify) {
            this._options = options;
            this._verify = verify;
            this._jwtFromRequest = options.jwtFromRequest;
        }
    }
    return {
        ExtractJwt: {
            fromAuthHeaderAsBearerToken: j.fn().mockReturnValue(() => 'bearer-token'),
            fromExtractors: j.fn((extractors) => {
                // Return a function that tries extractors in order
                return (req) => {
                    for (const extractor of extractors) {
                        const result = typeof extractor === 'function' ? extractor(req) : null;
                        if (result) return result;
                    }
                    return null;
                };
            }),
            fromUrlQueryParameter: j.fn().mockReturnValue((req) => {
                return req && req.query && req.query.token ? req.query.token : null;
            })
        },
        Strategy
    };
});

// Mock jwks-rsa
jestObj.mock('jwks-rsa', () => {
    const { jest: j } = require('@jest/globals');
    class SigningKeyNotFoundError extends Error {
        constructor (msg) {
            super(msg);
            this.name = 'SigningKeyNotFoundError';
        }
    }
    return {
        passportJwtSecret: j.fn((options) => options),
        SigningKeyNotFoundError
    };
});

// Mock logging
jestObj.mock('../../../operations/common/logging', () => {
    const { jest: j } = require('@jest/globals');
    return {
        logDebug: j.fn(),
        logError: j.fn(),
        logInfo: j.fn(),
        logWarn: j.fn()
    };
});

// Mock assertType
jestObj.mock('../../../utils/assertType', () => {
    const { jest: j } = require('@jest/globals');
    return {
        assertTypeEquals: j.fn(),
        assertIsValid: j.fn()
    };
});

const { MyJwtStrategy } = require('../../../strategies/jwt.bearer.strategy');
const { AuthService } = require('../../../strategies/authService');
const { ConfigManager } = require('../../../utils/configManager');
const jwksRsa = require('jwks-rsa');
const { logError } = require('../../../operations/common/logging');

function createMockInstance (ClassType) {
    const instance = Object.create(ClassType.prototype);
    return instance;
}

describe('MyJwtStrategy', () => {
    let mockAuthService;
    let mockConfigManager;

    beforeEach(() => {
        mockAuthService = createMockInstance(AuthService);
        mockAuthService.verify = jestObj.fn();
        mockAuthService.cookieExtractor = jestObj.fn().mockReturnValue(null);
        mockAuthService.getJwksByUrlAsync = jestObj.fn().mockResolvedValue({ keys: [] });
        mockAuthService.getExternalJwksAsync = jestObj.fn().mockResolvedValue([]);

        mockConfigManager = createMockInstance(ConfigManager);
        Object.defineProperty(mockConfigManager, 'authJwksUrl', { get: () => 'http://auth.example.com/.well-known/jwks.json' });
        Object.defineProperty(mockConfigManager, 'cacheExpiryTime', { get: () => 86400000 });
    });

    describe('constructor', () => {
        test('creates strategy instance with correct options', () => {
            const strategy = new MyJwtStrategy({
                authService: mockAuthService,
                configManager: mockConfigManager
            });

            expect(strategy).toBeDefined();
            expect(strategy.configManager).toBe(mockConfigManager);
        });

        test('passes custom options through to parent', () => {
            const strategy = new MyJwtStrategy({
                authService: mockAuthService,
                configManager: mockConfigManager,
                options: { issuer: 'http://issuer.com' }
            });

            expect(strategy._options.issuer).toBe('http://issuer.com');
        });

        test('configures passReqToCallback as true', () => {
            const strategy = new MyJwtStrategy({
                authService: mockAuthService,
                configManager: mockConfigManager
            });

            expect(strategy._options.passReqToCallback).toBe(true);
        });

        test('configures jsonWebTokenOptions with clock tolerance', () => {
            const strategy = new MyJwtStrategy({
                authService: mockAuthService,
                configManager: mockConfigManager
            });

            expect(strategy._options.jsonWebTokenOptions).toEqual({ clockTolerance: 30 });
        });

        test('configures secretOrKeyProvider with jwks-rsa settings', () => {
            const strategy = new MyJwtStrategy({
                authService: mockAuthService,
                configManager: mockConfigManager
            });

            const secretOrKeyProvider = strategy._options.secretOrKeyProvider;
            expect(secretOrKeyProvider).toBeDefined();
            expect(secretOrKeyProvider.cache).toBe(true);
            expect(secretOrKeyProvider.rateLimit).toBe(true);
            expect(secretOrKeyProvider.jwksRequestsPerMinute).toBe(60);
            expect(secretOrKeyProvider.jwksUri).toBe('http://auth.example.com/.well-known/jwks.json');
            expect(secretOrKeyProvider.cacheMaxAge).toBe(86400000);
        });

        test('fetcher calls authService.getJwksByUrlAsync', async () => {
            const strategy = new MyJwtStrategy({
                authService: mockAuthService,
                configManager: mockConfigManager
            });

            const fetcher = strategy._options.secretOrKeyProvider.fetcher;
            await fetcher('http://test.com/jwks');
            expect(mockAuthService.getJwksByUrlAsync).toHaveBeenCalledWith('http://test.com/jwks');
        });

        test('getKeysInterceptor calls authService.getExternalJwksAsync', async () => {
            const strategy = new MyJwtStrategy({
                authService: mockAuthService,
                configManager: mockConfigManager
            });

            const getKeysInterceptor = strategy._options.secretOrKeyProvider.getKeysInterceptor;
            const result = await getKeysInterceptor();
            expect(mockAuthService.getExternalJwksAsync).toHaveBeenCalled();
            expect(result).toEqual([]);
        });

        test('handleSigningKeyError returns custom error for SigningKeyNotFoundError', () => {
            const strategy = new MyJwtStrategy({
                authService: mockAuthService,
                configManager: mockConfigManager
            });

            const handler = strategy._options.secretOrKeyProvider.handleSigningKeyError;
            const cb = jestObj.fn();
            const signingKeyError = new jwksRsa.SigningKeyNotFoundError('key not found');

            handler(signingKeyError, cb);

            expect(logError).toHaveBeenCalledWith('JWKS signing key not found', expect.any(Object));
            expect(cb).toHaveBeenCalledWith(expect.objectContaining({ message: 'No Signing Key found!' }));
        });

        test('handleSigningKeyError passes through non-SigningKeyNotFoundError', () => {
            const strategy = new MyJwtStrategy({
                authService: mockAuthService,
                configManager: mockConfigManager
            });

            const handler = strategy._options.secretOrKeyProvider.handleSigningKeyError;
            const cb = jestObj.fn();
            const genericError = new Error('something else');

            handler(genericError, cb);

            expect(logError).toHaveBeenCalledWith('JWKS signing key error', expect.objectContaining({
                user: '',
                args: expect.objectContaining({ error: 'something else', type: 'Error' })
            }));
            expect(cb).toHaveBeenCalledWith(genericError);
        });
    });

    describe('jwtFromRequest extractors', () => {
        test('extracts token from cookie via authService.cookieExtractor', () => {
            mockAuthService.cookieExtractor = jestObj.fn().mockReturnValue('cookie-token');
            const strategy = new MyJwtStrategy({
                authService: mockAuthService,
                configManager: mockConfigManager
            });

            const jwtFromRequest = strategy._options.jwtFromRequest;
            const req = { cookies: { jwt: 'cookie-token' } };
            const result = jwtFromRequest(req);
            // The first extractor (bearer token) returns 'bearer-token' from our mock
            expect(result).toBe('bearer-token');
        });

        test('falls back to query parameter token', () => {
            // Mock all extractors to return null except the query param one
            const { ExtractJwt } = require('passport-jwt');
            ExtractJwt.fromAuthHeaderAsBearerToken.mockReturnValue(() => null);
            mockAuthService.cookieExtractor = jestObj.fn().mockReturnValue(null);

            const strategy = new MyJwtStrategy({
                authService: mockAuthService,
                configManager: mockConfigManager
            });

            const jwtFromRequest = strategy._options.jwtFromRequest;
            const req = { query: { token: 'query-token' } };
            const result = jwtFromRequest(req);
            expect(result).toBe('query-token');
        });
    });

    describe('verify callback', () => {
        test('calls authService.verify with correct params', () => {
            const strategy = new MyJwtStrategy({
                authService: mockAuthService,
                configManager: mockConfigManager
            });

            const done = jestObj.fn();
            const request = { headers: { authorization: 'Bearer test-token' } };
            const jwt_payload = { sub: 'user1', scope: 'user/*.read' };

            // Call the internal verify
            strategy._verify(request, jwt_payload, done);

            expect(mockAuthService.verify).toHaveBeenCalledWith(expect.objectContaining({
                request,
                jwt_payload,
                done
            }));
        });
    });
});
