const { describe, test, expect, beforeEach, jest } = require('@jest/globals');

/**
 * INC-322: Auth failure mode — transient infrastructure errors must NOT return 401.
 *
 * Production incident: When Redis evicted cached tokens (memory exhaustion), the
 * bwell-identity-gateway returned a HARD 401 "grant removed" instead of a 503 or
 * falling back to a backing store. This signaled downstream systems (Google) to
 * permanently drop grants — amplifying a temporary cache issue into permanent auth
 * failures for ~65,000 users.
 *
 * Lesson: Auth systems must NEVER return permanent-failure codes (401) for
 * temporary infrastructure problems. Transient failures should yield 503 or trigger
 * a fallback, not hard rejection.
 *
 * These tests assert CORRECT behavior and FAIL on the current buggy code.
 */

// --- Mocks ---
let fetchShouldFail;
let fetchError;

jest.mock('superagent', () => {
    const { jest: j } = require('@jest/globals');
    return {
        get: j.fn().mockReturnThis(),
        set: j.fn().mockReturnThis(),
        retry: j.fn().mockReturnThis(),
        timeout: j.fn(() => {
            if (fetchShouldFail) {
                return Promise.reject(fetchError || new Error('ECONNREFUSED'));
            }
            return Promise.resolve({ text: JSON.stringify({ keys: [{ kid: 'key1', kty: 'RSA', n: 'abc', e: 'AQAB' }] }) });
        })
    };
});

jest.mock('../../../operations/common/logging', () => {
    const { jest: j } = require('@jest/globals');
    return {
        logDebug: j.fn(),
        logError: j.fn(),
        logInfo: j.fn(),
        logWarn: j.fn()
    };
});

const { AuthService } = require('../../../strategies/authService');
const { ConfigManager } = require('../../../utils/configManager');
const { WellKnownConfigurationManager } = require('../../../utils/wellKnownConfiguration/wellKnownConfigurationManager');
const { authenticateWithJsonFailure } = require('../../../middleware/fhir/authentication.middleware');

function createMockInstance(ClassType) {
    const instance = Object.create(ClassType.prototype);
    return instance;
}

function createAuthService() {
    const mockConfigManager = createMockInstance(ConfigManager);
    Object.defineProperty(mockConfigManager, 'externalRequestTimeoutSec', { get: () => 30, configurable: true });
    Object.defineProperty(mockConfigManager, 'externalAuthJwksUrls', { get: () => ['http://auth.example.com/jwks'], configurable: true });
    Object.defineProperty(mockConfigManager, 'externalAuthWellKnownUrls', { get: () => [], configurable: true });
    Object.defineProperty(mockConfigManager, 'authCustomScope', { get: () => [], configurable: true });
    Object.defineProperty(mockConfigManager, 'authCustomGroup', { get: () => [], configurable: true });
    Object.defineProperty(mockConfigManager, 'authCustomUserName', { get: () => [], configurable: true });
    Object.defineProperty(mockConfigManager, 'authCustomSubject', { get: () => [], configurable: true });
    Object.defineProperty(mockConfigManager, 'authCustomClientId', { get: () => [], configurable: true });
    Object.defineProperty(mockConfigManager, 'authRemoveScopePrefixes', { get: () => [], configurable: true });
    Object.defineProperty(mockConfigManager, 'authCidCheckIssuer', { get: () => '', configurable: true });
    Object.defineProperty(mockConfigManager, 'authCidCheckClientIds', { get: () => [], configurable: true });
    Object.defineProperty(mockConfigManager, 'enableDelegatedAccessDetection', { get: () => false, configurable: true });
    Object.defineProperty(mockConfigManager, 'authJwksUrl', { get: () => 'http://auth.example.com/jwks', configurable: true });
    Object.defineProperty(mockConfigManager, 'cacheExpiryTime', { get: () => 600000, configurable: true });

    const mockWellKnownConfigManager = createMockInstance(WellKnownConfigurationManager);
    mockWellKnownConfigManager.getJwksUrlsAsync = jest.fn().mockResolvedValue([]);
    mockWellKnownConfigManager.getWellKnownConfigurationForIssuerAsync = jest.fn().mockResolvedValue(null);

    return new AuthService({
        configManager: mockConfigManager,
        wellKnownConfigurationManager: mockWellKnownConfigManager
    });
}

describe('INC-322: Auth failure mode — transient errors must not produce 401', () => {
    let authService;

    beforeEach(() => {
        AuthService.jwksCache = undefined;
        AuthService.userInfoCache = undefined;
        fetchShouldFail = false;
        fetchError = null;
        authService = createAuthService();
    });

    describe('Redis connection failure during auth should return 503, not 401', () => {
        /**
         * When JWKS keys are cached in Redis and Redis becomes unavailable,
         * getJwksByUrlAsync currently catches the error and returns {keys: []}.
         * This empty-keys response causes the signing key lookup to fail, which
         * passport-jwt translates into self.fail() -> 401.
         *
         * CORRECT behavior: A Redis/infrastructure failure should propagate as
         * a 503 Service Unavailable error, not a 401 Unauthorized.
         */
        test('getJwksByUrlAsync should throw a retriable error on connection failure, not return empty keys', async () => {
            fetchShouldFail = true;
            fetchError = new Error('ECONNREFUSED');
            fetchError.code = 'ECONNREFUSED';

            // CORRECT behavior: should throw an error that signals infrastructure failure
            // so callers can distinguish "we couldn't verify" from "token is invalid"
            await expect(
                authService.getJwksByUrlAsync('http://auth.example.com/jwks')
            ).rejects.toThrow();

            // BUG: Currently returns {keys: []} which is indistinguishable from
            // "the JWKS endpoint returned no keys" — a permanent condition
        });

        test('getExternalJwksAsync should propagate infrastructure errors, not swallow them', async () => {
            fetchShouldFail = true;
            fetchError = new Error('Redis connection refused');
            fetchError.code = 'ECONNREFUSED';

            // CORRECT behavior: infrastructure failure should propagate
            await expect(
                authService.getExternalJwksAsync()
            ).rejects.toThrow();

            // BUG: Currently catches the error and returns [] which causes
            // SigningKeyNotFoundError -> 401
        });
    });

    describe('JWKS fetch failure should return 503, not 401', () => {
        /**
         * When the JWKS endpoint is down (timeout, 5xx, network error),
         * the system should respond with 503, not 401. A JWKS endpoint
         * being unavailable does NOT mean the token is invalid.
         */
        test('JWKS network timeout should surface as infrastructure error, not auth failure', async () => {
            fetchShouldFail = true;
            fetchError = new Error('ETIMEDOUT');
            fetchError.code = 'ETIMEDOUT';
            fetchError.timeout = true;

            // CORRECT behavior: timeout should throw with an error that indicates
            // "service unavailable" not "authentication failed"
            let thrownError;
            try {
                await authService.getJwksByUrlAsync('http://auth.example.com/jwks');
            } catch (e) {
                thrownError = e;
            }

            // The method SHOULD throw on infrastructure failure
            expect(thrownError).toBeDefined();
            // And the error should be marked as transient/retriable
            expect(thrownError.isTransient || thrownError.statusCode === 503).toBe(true);
        });

        test('authentication middleware should return 503 when JWKS infrastructure fails', () => {
            // Simulate what happens when passport calls back with an infrastructure error
            // (i.e., err is set due to JWKS fetch failure)
            const middleware = authenticateWithJsonFailure('jwt', { session: false });

            const req = { headers: { authorization: 'Bearer valid.jwt.token' } };
            const res = {
                statusCode: null,
                body: null,
                status(code) { this.statusCode = code; return this; },
                json(data) { this.body = data; return this; }
            };
            const nextCalled = [];
            const next = (err) => { nextCalled.push(err); };

            // Mock passport.authenticate to simulate infrastructure error path
            // In the real flow: JWKS fetch fails -> secretOrKeyProvider calls cb(err)
            // -> passport calls self.fail(err) -> our middleware gets (null, false, err)
            // The error info contains the infrastructure failure details
            const passport = require('passport');
            const originalAuthenticate = passport.authenticate;

            // Simulate passport calling back with the infrastructure error
            passport.authenticate = (strategy, options, callback) => {
                return (mockReq, mockRes, mockNext) => {
                    // Passport's fail() path when secretOrKeyProvider errors
                    const infrastructureError = new Error('JWKS endpoint unreachable');
                    infrastructureError.isTransient = true;
                    callback(null, false, infrastructureError);
                };
            };

            middleware(req, res, next);

            // Restore
            passport.authenticate = originalAuthenticate;

            // CORRECT behavior: infrastructure failure should yield 503
            expect(res.statusCode).toBe(503);

            // BUG: Currently returns 401 because authenticateWithJsonFailure treats
            // all !user cases as auth failures without checking if the failure was
            // due to infrastructure issues vs actual invalid credentials
        });
    });

    describe('Cache miss should trigger fallback, not hard rejection', () => {
        /**
         * When the local LRU cache misses and the external JWKS fetch also fails,
         * the system should either:
         * 1. Retry/fallback to another source, OR
         * 2. Return 503 (not 401)
         *
         * It should NEVER treat "I couldn't reach the verification endpoint" as
         * "the token is definitely invalid."
         */
        test('cache miss with fetch failure should not produce false-negative auth result', async () => {
            // First, ensure cache is empty
            expect(AuthService.jwksCache.has('http://auth.example.com/jwks')).toBe(false);

            // Now make the fetch fail (simulating Redis eviction + endpoint down)
            fetchShouldFail = true;
            fetchError = new Error('Service Unavailable');
            fetchError.status = 503;

            const result = await authService.getJwksByUrlAsync('http://auth.example.com/jwks');

            // CORRECT behavior: The result should NOT be {keys: []} because that
            // falsely signals "there are no valid keys" when the truth is "we don't know"
            // It should either throw or return a sentinel that indicates uncertainty
            expect(result).not.toEqual({ keys: [] });

            // BUG: Currently returns {keys: []} which downstream interprets as
            // "no valid signing keys exist" -> SigningKeyNotFoundError -> 401
        });

        test('verify callback should not reject with auth failure when infrastructure is down', async () => {
            // When getUserInfoFromUserInfoEndpoint fails due to network issues,
            // verify() currently calls done(null, false, {reason: 'userinfo_endpoint_error'})
            // This triggers a 401, but the correct response is 503.

            const mockWellKnownConfigManager = createMockInstance(WellKnownConfigurationManager);
            mockWellKnownConfigManager.getJwksUrlsAsync = jest.fn().mockResolvedValue([]);
            mockWellKnownConfigManager.getWellKnownConfigurationForIssuerAsync = jest.fn()
                .mockResolvedValue({ userinfo_endpoint: 'http://auth.example.com/userinfo' });

            const mockConfigManager = createMockInstance(ConfigManager);
            Object.defineProperty(mockConfigManager, 'externalRequestTimeoutSec', { get: () => 30, configurable: true });
            Object.defineProperty(mockConfigManager, 'externalAuthJwksUrls', { get: () => [], configurable: true });
            Object.defineProperty(mockConfigManager, 'externalAuthWellKnownUrls', { get: () => [], configurable: true });
            Object.defineProperty(mockConfigManager, 'authCustomScope', { get: () => [], configurable: true });
            Object.defineProperty(mockConfigManager, 'authCustomGroup', { get: () => [], configurable: true });
            Object.defineProperty(mockConfigManager, 'authCustomUserName', { get: () => [], configurable: true });
            Object.defineProperty(mockConfigManager, 'authCustomSubject', { get: () => [], configurable: true });
            Object.defineProperty(mockConfigManager, 'authCustomClientId', { get: () => [], configurable: true });
            Object.defineProperty(mockConfigManager, 'authRemoveScopePrefixes', { get: () => [], configurable: true });
            Object.defineProperty(mockConfigManager, 'authCidCheckIssuer', { get: () => '', configurable: true });
            Object.defineProperty(mockConfigManager, 'authCidCheckClientIds', { get: () => [], configurable: true });
            Object.defineProperty(mockConfigManager, 'enableDelegatedAccessDetection', { get: () => false, configurable: true });

            AuthService.jwksCache = undefined;
            AuthService.userInfoCache = undefined;

            const svc = new AuthService({
                configManager: mockConfigManager,
                wellKnownConfigurationManager: mockWellKnownConfigManager
            });

            // Make the userinfo fetch fail with a transient error
            fetchShouldFail = true;
            fetchError = new Error('ETIMEDOUT');
            fetchError.code = 'ETIMEDOUT';

            const request = {};
            const jwt_payload = { iss: 'http://issuer.example.com', sub: 'user1' };

            const { err, user, info } = await new Promise((resolve) => {
                const verifyDone = (err, user, info) => {
                    resolve({ err, user, info });
                };
                svc.verify({ request, jwt_payload, token: 'some-token', done: verifyDone });
            });

            // CORRECT behavior: when userinfo endpoint fails due to infrastructure,
            // the error should be passed as first arg (err) so passport treats it
            // as an internal error (500/503), NOT as auth failure (user=false -> 401)
            expect(err).toBeDefined();
            expect(err.statusCode || err.status).toBe(503);

            // BUG: Currently calls done(null, false, {reason: 'userinfo_endpoint_error'})
            // which passport interprets as "auth failed" -> 401
        });
    });

    describe('Transient errors should never be surfaced as permanent auth failures', () => {
        /**
         * The core principle: if you cannot VERIFY a token (infrastructure down),
         * you MUST NOT claim it is INVALID (401). You should say "I don't know
         * right now" (503).
         */
        test('handleSigningKeyError should distinguish infrastructure errors from actual missing keys', () => {
            // In jwt.bearer.strategy.js, handleSigningKeyError currently treats
            // SigningKeyNotFoundError the same whether it occurred because:
            // a) The key truly doesn't exist (legitimate 401), or
            // b) The JWKS endpoint was unreachable so we got empty keys (should be 503)

            const jwksRsa = require('jwks-rsa');
            const { MyJwtStrategy } = require('../../../strategies/jwt.bearer.strategy');
            const { ConfigManager: CM } = require('../../../utils/configManager');

            const mockCM = createMockInstance(CM);
            Object.defineProperty(mockCM, 'authJwksUrl', { get: () => 'http://auth.example.com/jwks', configurable: true });
            Object.defineProperty(mockCM, 'cacheExpiryTime', { get: () => 600000, configurable: true });

            // Access the handleSigningKeyError that the strategy defines
            // We need to test that infrastructure errors are NOT treated as auth failures

            // Simulate an infrastructure error (not SigningKeyNotFoundError)
            const infrastructureError = new Error('ECONNREFUSED: connect failed');
            infrastructureError.code = 'ECONNREFUSED';

            let callbackError;
            const cb = (err) => { callbackError = err; };

            // The custom handleSigningKeyError in jwt.bearer.strategy.js:
            // - For SigningKeyNotFoundError: logs and returns cb(new Error('No Signing Key found!'))
            // - For other errors: logs and returns cb(err)
            //
            // When cb is called with an error, passport-jwt calls self.fail(err) -> 401
            //
            // CORRECT behavior for infrastructure errors: should call cb with an error
            // that has statusCode=503 or isTransient=true so the middleware can
            // distinguish it from a real auth failure

            // Simulate what handleSigningKeyError does with an infrastructure error
            const handleSigningKeyError = (err, callback) => {
                if (err instanceof jwksRsa.SigningKeyNotFoundError) {
                    return callback(new Error('No Signing Key found!'));
                }
                return callback(err);
            };

            handleSigningKeyError(infrastructureError, cb);

            // The error passed to passport should be marked as transient/503
            expect(callbackError).toBeDefined();
            expect(callbackError.statusCode).toBe(503);
            // Or alternatively:
            // expect(callbackError.isTransient).toBe(true);

            // BUG: Currently passes the raw error without any statusCode,
            // so passport-jwt calls self.fail(err) which the middleware
            // converts to a 401 response
        });

        test('authenticateWithJsonFailure should check error type before returning 401', () => {
            const middleware = authenticateWithJsonFailure('jwt', { session: false });

            const req = { headers: { authorization: 'Bearer some.jwt.token' } };
            const res = {
                statusCode: null,
                body: null,
                status(code) { this.statusCode = code; return this; },
                json(data) { this.body = data; return this; }
            };
            let nextError = null;
            const next = (err) => { nextError = err; };

            const passport = require('passport');
            const originalAuthenticate = passport.authenticate;

            // Simulate passport calling back with infrastructure error info
            passport.authenticate = (strategy, options, callback) => {
                return (mockReq, mockRes, mockNext) => {
                    // When the JWKS fetch times out, passport-jwt calls self.fail(err)
                    // which becomes: callback(null, false, errorInfo)
                    // The info object here is the timeout error
                    const timeoutInfo = new Error('ETIMEDOUT');
                    timeoutInfo.code = 'ETIMEDOUT';
                    timeoutInfo.isTransient = true;
                    callback(null, false, timeoutInfo);
                };
            };

            middleware(req, res, next);
            passport.authenticate = originalAuthenticate;

            // CORRECT behavior: transient infrastructure errors should produce 503
            // not 401. The middleware should inspect the info/error to determine
            // if this is a real auth failure or an infrastructure issue.
            expect(res.statusCode).not.toBe(401);
            expect(res.statusCode === 503 || (nextError && nextError.statusCode === 503)).toBe(true);

            // BUG: Currently always returns 401 for any !user case, regardless of
            // whether the failure was due to an invalid token or unreachable infrastructure
        });
    });
});
