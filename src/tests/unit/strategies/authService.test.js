const { describe, test, expect, beforeEach, afterEach, jest } = require('@jest/globals');

// Mock superagent
jest.mock('superagent', () => {
    const { jest: j } = require('@jest/globals');
    const mockResponse = { text: JSON.stringify({ keys: [{ kid: 'key1' }] }) };
    const agent = {
        get: j.fn().mockReturnThis(),
        set: j.fn().mockReturnThis(),
        retry: j.fn().mockReturnThis(),
        timeout: j.fn().mockResolvedValue(mockResponse)
    };
    return agent;
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

function createMockInstance(ClassType) {
    const instance = Object.create(ClassType.prototype);
    return instance;
}

describe('AuthService', () => {
    let authService;
    let mockConfigManager;
    let mockWellKnownConfigManager;

    beforeEach(() => {
        // Clear static caches
        AuthService.jwksCache = undefined;
        AuthService.userInfoCache = undefined;

        mockConfigManager = createMockInstance(ConfigManager);
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

        mockWellKnownConfigManager = createMockInstance(WellKnownConfigurationManager);
        mockWellKnownConfigManager.getJwksUrlsAsync = jest.fn().mockResolvedValue([]);
        mockWellKnownConfigManager.getWellKnownConfigurationForIssuerAsync = jest.fn().mockResolvedValue(null);

        authService = new AuthService({
            configManager: mockConfigManager,
            wellKnownConfigurationManager: mockWellKnownConfigManager
        });
    });

    // ========== CACHE ANALYSIS for getJwksByUrlAsync ==========
    // 1. Cache mechanism: AuthService.jwksCache (LRUCache) keyed by jwksUrl
    // 2. Cache KEY dimensions: jwksUrl
    // 3. Method PARAMETERS: jwksUrl
    // 4. Params NOT in cache key: N/A (single param IS the key)
    // 5. Cached VALUE: JSON response with keys array
    // 6. Downstream consumer: getExternalJwksAsync reads .keys
    // No bug surface here since sole param is the key.

    // ========== CACHE ANALYSIS for getUserInfoFromUserInfoEndpoint ==========
    // 1. Cache mechanism: AuthService.userInfoCache keyed by `${iss}-${cid}-${sub}`
    // 2. Cache KEY dimensions: jwt_payload.iss, jwt_payload.cid, jwt_payload.sub
    // 3. Method PARAMETERS: jwt_payload, token
    // 4. Params NOT in cache key: token (the bearer token)
    // 5. Cached VALUE: UserInfo object { scope, isUser, username, subject, clientId }
    // 6. Downstream consumer: verify() uses returned scope/username/isUser
    // 7. REQUIRED TEST: same {iss,cid,sub} but different token -> returns cached from call1
    // 8. MOCK SETUP: wellKnownConfig returns userinfo_endpoint, superagent returns body
    // 9. ASSERTION: result2 equals call1 values even with different token

    describe('getJwksByUrlAsync', () => {
        test('fetches and caches JWKS from URL', async () => {
            const result = await authService.getJwksByUrlAsync('http://example.com/jwks');
            expect(result).toEqual({ keys: [{ kid: 'key1' }] });
        });

        test('second call returns cached value', async () => {
            const result1 = await authService.getJwksByUrlAsync('http://example.com/jwks');
            const result2 = await authService.getJwksByUrlAsync('http://example.com/jwks');
            expect(result1).toEqual(result2);
        });

        test('different URLs are cached separately', async () => {
            await authService.getJwksByUrlAsync('http://example.com/jwks1');
            expect(AuthService.jwksCache.has('http://example.com/jwks1')).toBe(true);
            expect(AuthService.jwksCache.has('http://example.com/jwks2')).toBe(false);
        });
    });

    describe('getExternalJwksAsync', () => {
        test('returns empty array when no external URLs configured', async () => {
            const result = await authService.getExternalJwksAsync();
            expect(result).toEqual([]);
        });

        test('fetches keys from configured jwks URLs', async () => {
            Object.defineProperty(mockConfigManager, 'externalAuthJwksUrls', {
                get: () => ['http://example.com/jwks'], configurable: true
            });
            authService = new AuthService({
                configManager: mockConfigManager,
                wellKnownConfigurationManager: mockWellKnownConfigManager
            });
            const result = await authService.getExternalJwksAsync();
            expect(result).toEqual([{ kid: 'key1' }]);
        });
    });

    describe('cookieExtractor', () => {
        test('returns jwt from cookies', () => {
            const req = { cookies: { jwt: 'token123' } };
            expect(authService.cookieExtractor(req)).toBe('token123');
        });

        test('returns null when no cookies', () => {
            expect(authService.cookieExtractor({})).toBeNull();
            expect(authService.cookieExtractor(null)).toBeNull();
        });
    });

    // ========== getFieldsFromToken (large method) ==========
    describe('getFieldsFromToken', () => {
        test('extracts scope from jwt_payload.scope', () => {
            const result = authService.getFieldsFromToken({ scope: 'user/*.read', username: 'testuser' });
            expect(result.scope).toBe('user/*.read');
            expect(result.isUser).toBe(false);
        });

        test('isUser is true when scope contains patient/', () => {
            const result = authService.getFieldsFromToken({ scope: 'patient/Patient.read' });
            expect(result.isUser).toBe(true);
        });

        test('extracts username from payload', () => {
            const result = authService.getFieldsFromToken({ scope: 'user/*.read', username: 'john' });
            expect(result.username).toBe('john');
        });

        test('extracts clientId from client_id field', () => {
            const result = authService.getFieldsFromToken({ scope: 'user/*.read', client_id: 'my-client' });
            expect(result.clientId).toBe('my-client');
        });

        test('uses custom group property to augment scope', () => {
            Object.defineProperty(mockConfigManager, 'authCustomGroup', { get: () => ['groups'], configurable: true });
            authService = new AuthService({
                configManager: mockConfigManager,
                wellKnownConfigurationManager: mockWellKnownConfigManager
            });
            const result = authService.getFieldsFromToken({
                scope: 'user/*.read',
                groups: 'admin/Patient.*'
            });
            expect(result.scope).toContain('admin/Patient.*');
        });

        test('removes scope prefixes when configured', () => {
            Object.defineProperty(mockConfigManager, 'authRemoveScopePrefixes', {
                get: () => ['myapp:'], configurable: true
            });
            authService = new AuthService({
                configManager: mockConfigManager,
                wellKnownConfigurationManager: mockWellKnownConfigManager
            });
            const result = authService.getFieldsFromToken({
                scope: 'myapp:user/*.read myapp:patient/Patient.read'
            });
            expect(result.scope).toBe('user/*.read patient/Patient.read');
            expect(result.isUser).toBe(true);
        });
    });

    // ========== getPropertiesFromPayload ==========
    describe('getPropertiesFromPayload', () => {
        test('returns array of matching properties', () => {
            const result = authService.getPropertiesFromPayload({
                jwt_payload: { groups: 'admin', roles: 'editor' },
                propertyNames: ['groups', 'roles']
            });
            expect(result).toEqual(['admin', 'editor']);
        });

        test('handles comma-separated string for propertyNames', () => {
            const result = authService.getPropertiesFromPayload({
                jwt_payload: { groups: 'admin' },
                propertyNames: 'groups, missing'
            });
            expect(result).toEqual(['admin']);
        });

        test('joins array values with space', () => {
            const result = authService.getPropertiesFromPayload({
                jwt_payload: { groups: ['a', 'b'] },
                propertyNames: ['groups']
            });
            expect(result).toEqual(['a b']);
        });

        test('returns empty array when propertyNames undefined', () => {
            const result = authService.getPropertiesFromPayload({
                jwt_payload: { groups: 'admin' },
                propertyNames: undefined
            });
            expect(result).toEqual([]);
        });
    });

    // ========== getFirstPropertyFromPayload ==========
    describe('getFirstPropertyFromPayload', () => {
        test('returns first matching property', () => {
            const result = authService.getFirstPropertyFromPayload({
                jwt_payload: { name: 'John', email: 'john@example.com' },
                propertyNames: ['missing', 'name']
            });
            expect(result).toBe('John');
        });

        test('returns null when no match', () => {
            const result = authService.getFirstPropertyFromPayload({
                jwt_payload: {},
                propertyNames: ['missing']
            });
            expect(result).toBeNull();
        });
    });

    // ========== processUserInfo (large method) ==========
    describe('processUserInfo', () => {
        test('calls done with user info for non-user token', () => {
            const done = jest.fn();
            authService.processUserInfo({
                username: 'testuser',
                subject: 'sub1',
                isUser: false,
                jwt_payload: {},
                done,
                client_id: 'client1',
                scope: 'user/*.read'
            });
            expect(done).toHaveBeenCalledWith(
                null,
                expect.objectContaining({ id: 'client1', name: 'testuser' }),
                expect.objectContaining({ scope: 'user/*.read' })
            );
        });

        test('rejects user token with missing required fields', () => {
            const done = jest.fn();
            authService.processUserInfo({
                username: 'testuser',
                subject: 'sub1',
                isUser: true,
                jwt_payload: { clientFhirPersonId: 'p1' }, // missing other required fields
                done,
                client_id: 'client1',
                scope: 'patient/Patient.read'
            });
            expect(done).toHaveBeenCalledWith(null, false, { reason: 'missing_required_jwt_field' });
        });

        test('accepts user token with all required fields', () => {
            const done = jest.fn();
            authService.processUserInfo({
                username: 'testuser',
                subject: 'sub1',
                isUser: true,
                jwt_payload: {
                    clientFhirPersonId: 'person-1',
                    clientFhirPatientId: 'patient-1',
                    bwellFhirPersonId: 'bwell-person-1',
                    bwellFhirPatientId: 'bwell-patient-1',
                    sub: 'subject-1'
                },
                done,
                client_id: 'client1',
                scope: 'patient/Patient.read'
            });
            expect(done).toHaveBeenCalledWith(
                null,
                expect.objectContaining({ id: 'client1', isUser: true }),
                expect.objectContaining({ scope: 'patient/Patient.read' })
            );
        });
    });

    // ========== processForDelegatedActor ==========
    describe('processForDelegatedActor', () => {
        test('returns null actor for string act claim', () => {
            const result = authService.processForDelegatedActor({
                jwt_payload: { act: 'some-string' }
            });
            expect(result.actor).toBeNull();
            expect(result.failure).toBe(false);
        });

        test('returns failure for invalid act reference', () => {
            const result = authService.processForDelegatedActor({
                jwt_payload: { act: { reference: 'Patient/123', sub: 'sub1' } }
            });
            expect(result.failure).toBe(true);
        });

        test('returns actor for valid act claim', () => {
            const result = authService.processForDelegatedActor({
                jwt_payload: { act: { reference: 'RelatedPerson/rp-1', sub: 'delegatee-sub' } }
            });
            expect(result.actor).toEqual({
                reference: 'RelatedPerson/rp-1',
                sub: 'delegatee-sub'
            });
            expect(result.failure).toBe(false);
        });

        test('returns failure when sub is missing', () => {
            const result = authService.processForDelegatedActor({
                jwt_payload: { act: { reference: 'RelatedPerson/rp-1' } }
            });
            expect(result.failure).toBe(true);
        });
    });

    // ========== verify (large method) ==========
    describe('verify', () => {
        test('rejects when jwt_payload is null', () => {
            const done = jest.fn();
            authService.verify({ request: {}, jwt_payload: null, token: 'tok', done });
            expect(done).toHaveBeenCalledWith(null, false, { reason: 'missing_jwt_payload' });
        });

        test('rejects when cid check fails', () => {
            authService.cidCheckIssuer = 'http://issuer';
            authService.cidCheckClientIds = ['allowed-cid'];
            const done = jest.fn();
            authService.verify({
                request: {},
                jwt_payload: { iss: 'http://issuer', cid: 'not-allowed', scope: 'user/*.read' },
                token: 'tok',
                done
            });
            expect(done).toHaveBeenCalledWith(null, false, { reason: 'client_id_not_allowed_for_issuer' });
        });

        test('processes user info when scope present', () => {
            const done = jest.fn();
            const request = {};
            authService.verify({
                request,
                jwt_payload: { scope: 'user/*.read', client_id: 'c1', username: 'u1' },
                token: 'tok',
                done
            });
            expect(done).toHaveBeenCalledWith(
                null,
                expect.objectContaining({ id: 'c1' }),
                expect.objectContaining({ scope: 'user/*.read' })
            );
            expect(request.jwtPayload).toBeDefined();
        });
    });

    // ========== userInfoCache test ==========
    describe('getUserInfoFromUserInfoEndpoint cache', () => {
        test('second call with same iss-cid-sub but different token returns cached value', async () => {
            // Manually set up a cached entry
            const cacheKey = 'issuer1-cid1-sub1';
            const cachedUserInfo = {
                scope: 'cached-scope',
                isUser: false,
                username: 'cached-user',
                subject: 'cached-sub',
                clientId: 'cached-cid'
            };
            AuthService.userInfoCache.set(cacheKey, cachedUserInfo);

            const result = await authService.getUserInfoFromUserInfoEndpoint({
                jwt_payload: { iss: 'issuer1', cid: 'cid1', sub: 'sub1' },
                token: 'completely-different-token'
            });

            expect(result).toEqual(cachedUserInfo);
        });
    });

    // ========== clearAuthCache ==========
    describe('clearAuthCache', () => {
        test('clears both caches', () => {
            AuthService.jwksCache.set('key1', 'val1');
            AuthService.userInfoCache.set('key2', 'val2');
            authService.clearAuthCache();
            expect(AuthService.jwksCache.size).toBe(0);
            expect(AuthService.userInfoCache.size).toBe(0);
        });
    });
});
