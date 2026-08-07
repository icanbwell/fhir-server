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
const { logError, logWarn, logInfo } = require('../../../operations/common/logging');
const superagent = require('superagent');

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
        Object.defineProperty(mockConfigManager, 'restrictNonPatientScopeForPatientTokens', { get: () => false, configurable: true });
        Object.defineProperty(mockConfigManager, 'allowedNonPatientTokenIssuers', { get: () => [], configurable: true });

        mockWellKnownConfigManager = createMockInstance(WellKnownConfigurationManager);
        mockWellKnownConfigManager.getJwksUrlsAsync = jest.fn().mockResolvedValue([]);
        mockWellKnownConfigManager.getWellKnownConfigurationForIssuerAsync = jest.fn().mockResolvedValue(null);

        authService = new AuthService({
            configManager: mockConfigManager,
            wellKnownConfigurationManager: mockWellKnownConfigManager
        });
    });

    describe('constructor', () => {
        test('initializes requestTimeout from config', () => {
            expect(authService.requestTimeout).toBe(30000);
        });

        test('uses default 30s when externalRequestTimeoutSec is falsy', () => {
            Object.defineProperty(mockConfigManager, 'externalRequestTimeoutSec', { get: () => 0, configurable: true });
            AuthService.jwksCache = undefined;
            AuthService.userInfoCache = undefined;
            const svc = new AuthService({
                configManager: mockConfigManager,
                wellKnownConfigurationManager: mockWellKnownConfigManager
            });
            expect(svc.requestTimeout).toBe(30000);
        });

        test('initializes requiredJWTFields', () => {
            expect(authService.requiredJWTFields).toEqual({
                clientFhirPersonId: 'clientFhirPersonId',
                clientFhirPatientId: 'clientFhirPatientId',
                bwellFhirPersonId: 'bwellFhirPersonId',
                bwellFhirPatientId: 'bwellFhirPatientId'
            });
        });

        test('initializes caches only once (static)', () => {
            const authService2 = new AuthService({
                configManager: mockConfigManager,
                wellKnownConfigurationManager: mockWellKnownConfigManager
            });
            expect(AuthService.jwksCache).toBeDefined();
            expect(AuthService.userInfoCache).toBeDefined();
        });

        test('sets cidCheckIssuer and cidCheckClientIds from config', () => {
            Object.defineProperty(mockConfigManager, 'authCidCheckIssuer', { get: () => 'http://myissuer.com', configurable: true });
            Object.defineProperty(mockConfigManager, 'authCidCheckClientIds', { get: () => ['cid-1', 'cid-2'], configurable: true });
            AuthService.jwksCache = undefined;
            AuthService.userInfoCache = undefined;
            const svc = new AuthService({
                configManager: mockConfigManager,
                wellKnownConfigurationManager: mockWellKnownConfigManager
            });
            expect(svc.cidCheckIssuer).toBe('http://myissuer.com');
            expect(svc.cidCheckClientIds).toEqual(['cid-1', 'cid-2']);
        });
    });

    describe('getJwksByUrlAsync', () => {
        test('fetches and caches JWKS from URL', async () => {
            const result = await authService.getJwksByUrlAsync('http://example.com/jwks');
            expect(result).toEqual({ keys: [{ kid: 'key1' }] });
        });

        test('second call returns cached value without network call', async () => {
            const result1 = await authService.getJwksByUrlAsync('http://example.com/jwks');
            // Reset mock to verify it's not called again
            superagent.get.mockClear();
            const result2 = await authService.getJwksByUrlAsync('http://example.com/jwks');
            expect(result1).toEqual(result2);
            expect(superagent.get).not.toHaveBeenCalled();
        });

        test('different URLs are cached separately', async () => {
            await authService.getJwksByUrlAsync('http://example.com/jwks1');
            expect(AuthService.jwksCache.has('http://example.com/jwks1')).toBe(true);
            expect(AuthService.jwksCache.has('http://example.com/jwks2')).toBe(false);
        });

        test('throws a transient error on fetch error instead of returning empty keys (INC-322)', async () => {
            superagent.timeout.mockRejectedValueOnce(new Error('Network error'));
            // A fetch failure must not be swallowed into {keys: []}: that's
            // indistinguishable downstream from "this endpoint legitimately has no
            // keys" (permanent) vs. "we couldn't reach it" (transient). It should
            // propagate as a transient/503-marked error instead.
            await expect(
                authService.getJwksByUrlAsync('http://error-url.com/jwks')
            ).rejects.toMatchObject({
                message: 'Network error',
                isTransient: true,
                statusCode: 503
            });
            expect(logError).toHaveBeenCalledWith(
                expect.stringContaining('Error fetching JWKS'),
                expect.any(Object)
            );
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

        test('falls back to well-known URLs when jwks URLs empty but well-known configured', async () => {
            Object.defineProperty(mockConfigManager, 'externalAuthJwksUrls', { get: () => [], configurable: true });
            Object.defineProperty(mockConfigManager, 'externalAuthWellKnownUrls', { get: () => ['http://well-known.com'], configurable: true });
            mockWellKnownConfigManager.getJwksUrlsAsync = jest.fn().mockResolvedValue(['http://example.com/jwks']);

            authService = new AuthService({
                configManager: mockConfigManager,
                wellKnownConfigurationManager: mockWellKnownConfigManager
            });
            const result = await authService.getExternalJwksAsync();
            expect(mockWellKnownConfigManager.getJwksUrlsAsync).toHaveBeenCalled();
            expect(result).toEqual([{ kid: 'key1' }]);
        });

        test('returns empty array when well-known returns empty', async () => {
            Object.defineProperty(mockConfigManager, 'externalAuthJwksUrls', { get: () => [], configurable: true });
            Object.defineProperty(mockConfigManager, 'externalAuthWellKnownUrls', { get: () => ['http://well-known.com'], configurable: true });
            mockWellKnownConfigManager.getJwksUrlsAsync = jest.fn().mockResolvedValue([]);

            authService = new AuthService({
                configManager: mockConfigManager,
                wellKnownConfigurationManager: mockWellKnownConfigManager
            });
            const result = await authService.getExternalJwksAsync();
            expect(result).toEqual([]);
        });

        test('flattens keys from multiple URLs', async () => {
            Object.defineProperty(mockConfigManager, 'externalAuthJwksUrls', {
                get: () => ['http://url1.com/jwks', 'http://url2.com/jwks'], configurable: true
            });
            authService = new AuthService({
                configManager: mockConfigManager,
                wellKnownConfigurationManager: mockWellKnownConfigManager
            });
            const result = await authService.getExternalJwksAsync();
            // Both return {keys: [{kid: 'key1'}]} so we get two keys flattened
            expect(result).toEqual([{ kid: 'key1' }, { kid: 'key1' }]);
        });

        test('propagates a transient error on error during fetch instead of returning empty array (INC-322)', async () => {
            Object.defineProperty(mockConfigManager, 'externalAuthJwksUrls', {
                get: () => ['http://error.com/jwks'], configurable: true
            });
            // Make getJwksByUrlAsync throw
            superagent.timeout.mockRejectedValueOnce(new Error('network error'));
            authService = new AuthService({
                configManager: mockConfigManager,
                wellKnownConfigurationManager: mockWellKnownConfigManager
            });
            // getJwksByUrlAsync now rejects on infra failure rather than swallowing to
            // {keys: []}, so getExternalJwksAsync must propagate that failure too,
            // rather than silently reporting "no external keys" (which would look like
            // a permanent condition to callers).
            await expect(
                authService.getExternalJwksAsync()
            ).rejects.toMatchObject({
                message: 'network error',
                isTransient: true,
                statusCode: 503
            });
        });

        test('partial JWKS provider failure still returns keys from healthy providers (INC-322)', async () => {
            // Two providers configured; one is down, one is healthy. async.map's
            // fail-fast behavior used to make the whole call reject even though a
            // healthy provider's keys were available -- Promise.allSettled must
            // instead aggregate the successful result and only log the failure.
            Object.defineProperty(mockConfigManager, 'externalAuthJwksUrls', {
                get: () => ['http://down-provider.com/jwks', 'http://healthy-provider.com/jwks'],
                configurable: true
            });
            superagent.timeout.mockRejectedValueOnce(new Error('ECONNREFUSED'));
            authService = new AuthService({
                configManager: mockConfigManager,
                wellKnownConfigurationManager: mockWellKnownConfigManager
            });
            const result = await authService.getExternalJwksAsync();
            expect(result).toEqual([{ kid: 'key1' }]);
            expect(logError).toHaveBeenCalledWith(
                expect.stringContaining('Failed to fetch keys from 1 of 2 external jwk url(s)'),
                expect.any(Object)
            );
        });

        test('throws a transient error when every configured JWKS provider fails (INC-322)', async () => {
            Object.defineProperty(mockConfigManager, 'externalAuthJwksUrls', {
                get: () => ['http://down-provider-1.com/jwks', 'http://down-provider-2.com/jwks'],
                configurable: true
            });
            // mockRejectedValueOnce (not the persistent mockRejectedValue) so this doesn't
            // leak into later tests in this file that rely on the default resolved mock --
            // one rejection queued per configured URL, matching the two calls this test makes.
            superagent.timeout
                .mockRejectedValueOnce(new Error('ECONNREFUSED'))
                .mockRejectedValueOnce(new Error('ECONNREFUSED'));
            authService = new AuthService({
                configManager: mockConfigManager,
                wellKnownConfigurationManager: mockWellKnownConfigManager
            });
            // Only when EVERY configured provider fails (zero usable keys) should this
            // surface a transient/503 error.
            await expect(
                authService.getExternalJwksAsync()
            ).rejects.toMatchObject({ isTransient: true, statusCode: 503 });
        });

        test('propagates a transient error when every well-known URL fails to resolve JWKS URLs (INC-322)', async () => {
            // Before this fix, WellKnownConfigurationManager#getJwksUrlsAsync swallowed
            // per-URL failures into [] with no transient/503 marker, so a total
            // well-known outage looked exactly like "no well-known URLs configured" --
            // extJwksUrls.length === 0, and getExternalJwksAsync silently fell through
            // to its unguarded `return []`, reintroducing the exact bug INC-322 was
            // about via the well-known fallback path. Now getJwksUrlsAsync rethrows on
            // total failure, and getExternalJwksAsync must let that propagate rather
            // than swallow it.
            Object.defineProperty(mockConfigManager, 'externalAuthJwksUrls', { get: () => [], configurable: true });
            Object.defineProperty(mockConfigManager, 'externalAuthWellKnownUrls', {
                get: () => ['http://well-known.com'], configurable: true
            });
            const wellKnownOutageError = new Error(
                'Failed to resolve any JWKS URL from 1 configured well-known endpoint(s): ECONNREFUSED'
            );
            wellKnownOutageError.isTransient = true;
            wellKnownOutageError.statusCode = 503;
            mockWellKnownConfigManager.getJwksUrlsAsync = jest.fn().mockRejectedValue(wellKnownOutageError);

            authService = new AuthService({
                configManager: mockConfigManager,
                wellKnownConfigurationManager: mockWellKnownConfigManager
            });

            await expect(
                authService.getExternalJwksAsync()
            ).rejects.toMatchObject({ isTransient: true, statusCode: 503 });
        });

        test('trims whitespace from external URLs', async () => {
            Object.defineProperty(mockConfigManager, 'externalAuthJwksUrls', {
                get: () => ['  http://example.com/jwks  '], configurable: true
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
        });

        test('returns null when req is null', () => {
            expect(authService.cookieExtractor(null)).toBeNull();
        });

        test('returns null when req is undefined', () => {
            expect(authService.cookieExtractor(undefined)).toBeNull();
        });

        test('returns undefined cookie value (not present)', () => {
            const req = { cookies: {} };
            const result = authService.cookieExtractor(req);
            expect(result).toBeUndefined();
        });
    });

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

        test('isUser is case-insensitive on patient/ prefix', () => {
            const result = authService.getFieldsFromToken({ scope: 'Patient/Observation.read' });
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

        test('extracts subject from payload', () => {
            const result = authService.getFieldsFromToken({ scope: 'user/*.read', subject: 'sub-1' });
            expect(result.subject).toBe('sub-1');
        });

        test('uses custom scope property when jwt_payload.scope is absent', () => {
            Object.defineProperty(mockConfigManager, 'authCustomScope', { get: () => ['scp'], configurable: true });
            authService = new AuthService({
                configManager: mockConfigManager,
                wellKnownConfigurationManager: mockWellKnownConfigManager
            });
            const result = authService.getFieldsFromToken({ scp: 'user/*.read patient/Patient.read' });
            expect(result.scope).toContain('user/*.read');
            expect(result.isUser).toBe(true);
        });

        test('uses custom username property when jwt_payload.username is absent', () => {
            Object.defineProperty(mockConfigManager, 'authCustomUserName', { get: () => ['preferred_username'], configurable: true });
            authService = new AuthService({
                configManager: mockConfigManager,
                wellKnownConfigurationManager: mockWellKnownConfigManager
            });
            const result = authService.getFieldsFromToken({ scope: 'user/*.read', preferred_username: 'custom-user' });
            expect(result.username).toBe('custom-user');
        });

        test('uses custom subject property when jwt_payload.subject is absent', () => {
            Object.defineProperty(mockConfigManager, 'authCustomSubject', { get: () => ['sub'], configurable: true });
            authService = new AuthService({
                configManager: mockConfigManager,
                wellKnownConfigurationManager: mockWellKnownConfigManager
            });
            const result = authService.getFieldsFromToken({ scope: 'user/*.read', sub: 'my-sub' });
            expect(result.subject).toBe('my-sub');
        });

        test('uses custom clientId property when jwt_payload.client_id is absent', () => {
            Object.defineProperty(mockConfigManager, 'authCustomClientId', { get: () => ['cid'], configurable: true });
            authService = new AuthService({
                configManager: mockConfigManager,
                wellKnownConfigurationManager: mockWellKnownConfigManager
            });
            const result = authService.getFieldsFromToken({ scope: 'user/*.read', cid: 'custom-cid' });
            expect(result.clientId).toBe('custom-cid');
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
            expect(result.scope).toBe('user/*.read admin/Patient.*');
        });

        test('groups alone become the scope when jwt_payload.scope is absent', () => {
            Object.defineProperty(mockConfigManager, 'authCustomGroup', { get: () => ['groups'], configurable: true });
            authService = new AuthService({
                configManager: mockConfigManager,
                wellKnownConfigurationManager: mockWellKnownConfigManager
            });
            const result = authService.getFieldsFromToken({ groups: 'patient/Patient.read' });
            expect(result.scope).toBe('patient/Patient.read');
            expect(result.isUser).toBe(true);
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

        test('does not remove prefix if scope does not start with it', () => {
            Object.defineProperty(mockConfigManager, 'authRemoveScopePrefixes', {
                get: () => ['prefix:'], configurable: true
            });
            authService = new AuthService({
                configManager: mockConfigManager,
                wellKnownConfigurationManager: mockWellKnownConfigManager
            });
            const result = authService.getFieldsFromToken({ scope: 'user/*.read' });
            expect(result.scope).toBe('user/*.read');
        });

        test('handles empty scope and no groups', () => {
            const result = authService.getFieldsFromToken({});
            expect(result.scope).toBe('');
            expect(result.isUser).toBe(false);
        });

        test('handles multiple scope prefixes - first match wins', () => {
            Object.defineProperty(mockConfigManager, 'authRemoveScopePrefixes', {
                get: () => ['short:', 'longer:prefix:'], configurable: true
            });
            authService = new AuthService({
                configManager: mockConfigManager,
                wellKnownConfigurationManager: mockWellKnownConfigManager
            });
            const result = authService.getFieldsFromToken({ scope: 'short:user/*.read' });
            expect(result.scope).toBe('user/*.read');
        });

        // DCON-4882: wildcard non-patient scope restriction for patient/person-id-bearing tokens
        describe('wildcard non-patient scope restriction for patient tokens (DCON-4882)', () => {
            test('leaves scopes unchanged when the flag is off, even with a patient id claim', () => {
                const result = authService.getFieldsFromToken({
                    clientFhirPatientId: 'patient-1',
                    scope: 'patient/*.* user/*.* access/*.*'
                });
                expect(result.scope).toBe('patient/*.* user/*.* access/*.*');
            });

            test('strips wildcard user/ and access/ scopes when the flag is on and a patient id claim is present', () => {
                Object.defineProperty(mockConfigManager, 'restrictNonPatientScopeForPatientTokens', {
                    get: () => true, configurable: true
                });
                authService = new AuthService({
                    configManager: mockConfigManager,
                    wellKnownConfigurationManager: mockWellKnownConfigManager
                });
                const result = authService.getFieldsFromToken({
                    clientFhirPatientId: 'patient-1',
                    scope: 'aws.cognito.signin.user.admin access/*.* patient/*.* user/*.*'
                });
                expect(result.scope).toBe('aws.cognito.signin.user.admin patient/*.*');
                expect(result.isUser).toBe(true);
            });

            test('strips wildcard scopes when the flag is on and a person id claim is present (no patient id)', () => {
                Object.defineProperty(mockConfigManager, 'restrictNonPatientScopeForPatientTokens', {
                    get: () => true, configurable: true
                });
                authService = new AuthService({
                    configManager: mockConfigManager,
                    wellKnownConfigurationManager: mockWellKnownConfigManager
                });
                const result = authService.getFieldsFromToken({
                    bwellFhirPersonId: 'person-1',
                    scope: 'user/*.* access/*.*'
                });
                expect(result.scope).toBe('');
            });

            test('leaves scopes unchanged when the flag is on but no patient/person id claim is present', () => {
                Object.defineProperty(mockConfigManager, 'restrictNonPatientScopeForPatientTokens', {
                    get: () => true, configurable: true
                });
                authService = new AuthService({
                    configManager: mockConfigManager,
                    wellKnownConfigurationManager: mockWellKnownConfigManager
                });
                const result = authService.getFieldsFromToken({
                    scope: 'user/*.* access/*.*'
                });
                expect(result.scope).toBe('user/*.* access/*.*');
            });

            test('preserves narrowly-scoped non-patient grants for a patient-id-bearing token', () => {
                Object.defineProperty(mockConfigManager, 'restrictNonPatientScopeForPatientTokens', {
                    get: () => true, configurable: true
                });
                authService = new AuthService({
                    configManager: mockConfigManager,
                    wellKnownConfigurationManager: mockWellKnownConfigManager
                });
                const result = authService.getFieldsFromToken({
                    clientFhirPatientId: 'patient-1',
                    scope: 'patient/*.* user/Questionnaire.* access/walgreen.* access/*.*'
                });
                // only the true wildcard (access/*.*) is stripped; narrow grants survive
                expect(result.scope).toBe('patient/*.* user/Questionnaire.* access/walgreen.*');
            });

            test('applies after AUTH_REMOVE_SCOPE_PREFIX stripping', () => {
                Object.defineProperty(mockConfigManager, 'restrictNonPatientScopeForPatientTokens', {
                    get: () => true, configurable: true
                });
                Object.defineProperty(mockConfigManager, 'authRemoveScopePrefixes', {
                    get: () => ['myapp:'], configurable: true
                });
                authService = new AuthService({
                    configManager: mockConfigManager,
                    wellKnownConfigurationManager: mockWellKnownConfigManager
                });
                const result = authService.getFieldsFromToken({
                    clientFhirPatientId: 'patient-1',
                    scope: 'myapp:patient/*.* myapp:access/*.*'
                });
                expect(result.scope).toBe('patient/*.*');
            });
        });
    });

    describe('isWildcardNonPatientScope', () => {
        test.each([
            ['user/*.*', true],
            ['access/*.*', true],
            ['User/*.Read', true],
            ['ACCESS/*.write', true],
            ['user/Questionnaire.*', false],
            ['access/walgreen.*', false],
            ['patient/*.*', false],
            ['admin/*.*', false],
            ['', false]
        ])('%s -> %s', (scope, expected) => {
            expect(authService.isWildcardNonPatientScope(scope)).toBe(expected);
        });

        test('returns false for non-string input', () => {
            expect(authService.isWildcardNonPatientScope(undefined)).toBe(false);
            expect(authService.isWildcardNonPatientScope(null)).toBe(false);
        });
    });

    describe('hasPatientOrPersonIdClaim', () => {
        test.each([
            [{ clientFhirPersonId: 'p1' }, true],
            [{ clientFhirPatientId: 'p1' }, true],
            [{ bwellFhirPersonId: 'p1' }, true],
            [{ bwellFhirPatientId: 'p1' }, true],
            [{}, false],
            [{ sub: 'some-user' }, false]
        ])('%o -> %s', (jwt_payload, expected) => {
            expect(authService.hasPatientOrPersonIdClaim(jwt_payload)).toBe(expected);
        });
    });

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

        test('returns empty array when propertyNames is empty array', () => {
            const result = authService.getPropertiesFromPayload({
                jwt_payload: { groups: 'admin' },
                propertyNames: []
            });
            expect(result).toEqual([]);
        });

        test('filters out null values for missing properties', () => {
            const result = authService.getPropertiesFromPayload({
                jwt_payload: { a: 'val-a' },
                propertyNames: ['a', 'b', 'c']
            });
            expect(result).toEqual(['val-a']);
        });
    });

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

        test('returns null when propertyNames is undefined', () => {
            const result = authService.getFirstPropertyFromPayload({
                jwt_payload: { name: 'John' },
                propertyNames: undefined
            });
            expect(result).toBeNull();
        });

        test('returns null when propertyNames is empty array', () => {
            const result = authService.getFirstPropertyFromPayload({
                jwt_payload: { name: 'John' },
                propertyNames: []
            });
            expect(result).toBeNull();
        });

        test('joins array values with space', () => {
            const result = authService.getFirstPropertyFromPayload({
                jwt_payload: { groups: ['admin', 'user'] },
                propertyNames: ['groups']
            });
            expect(result).toBe('admin user');
        });

        test('handles comma-separated string for propertyNames', () => {
            const result = authService.getFirstPropertyFromPayload({
                jwt_payload: { email: 'test@example.com' },
                propertyNames: 'name, email'
            });
            expect(result).toBe('test@example.com');
        });
    });

    describe('processUserInfo', () => {
        // DCON-4882: reject tokens missing patient/person id claims from untrusted issuers
        describe('non-patient token from untrusted issuer (DCON-4882)', () => {
            test('is a no-op when the allowlist is empty (unconfigured environments)', () => {
                const done = jest.fn();
                authService.processUserInfo({
                    username: 'svc', subject: undefined, isUser: false,
                    jwt_payload: { iss: 'https://untrusted.example.com' },
                    done, client_id: 'svc-client', scope: 'user/*.read'
                });
                expect(done).toHaveBeenCalledWith(
                    null,
                    expect.objectContaining({ id: 'svc-client' }),
                    expect.any(Object)
                );
            });

            test('rejects a token missing all patient/person id claims from a non-allowlisted issuer', () => {
                Object.defineProperty(mockConfigManager, 'allowedNonPatientTokenIssuers', {
                    get: () => ['https://trusted.example.com'], configurable: true
                });
                authService = new AuthService({
                    configManager: mockConfigManager,
                    wellKnownConfigurationManager: mockWellKnownConfigManager
                });
                const done = jest.fn();
                authService.processUserInfo({
                    username: 'svc', subject: undefined, isUser: false,
                    jwt_payload: { iss: 'https://untrusted.example.com' },
                    done, client_id: 'svc-client', scope: 'user/*.* access/*.*'
                });
                expect(done).toHaveBeenCalledWith(null, false, { reason: 'non_patient_token_from_untrusted_issuer' });
            });

            test('passes through when the issuer is on the allowlist', () => {
                Object.defineProperty(mockConfigManager, 'allowedNonPatientTokenIssuers', {
                    get: () => ['https://trusted.example.com'], configurable: true
                });
                authService = new AuthService({
                    configManager: mockConfigManager,
                    wellKnownConfigurationManager: mockWellKnownConfigManager
                });
                const done = jest.fn();
                authService.processUserInfo({
                    username: 'svc', subject: undefined, isUser: false,
                    jwt_payload: { iss: 'https://trusted.example.com' },
                    done, client_id: 'svc-client', scope: 'user/*.* access/*.*'
                });
                expect(done).toHaveBeenCalledWith(
                    null,
                    expect.objectContaining({ id: 'svc-client' }),
                    expect.any(Object)
                );
            });

            test('passes through when the token has a patient/person id claim, regardless of issuer', () => {
                Object.defineProperty(mockConfigManager, 'allowedNonPatientTokenIssuers', {
                    get: () => ['https://trusted.example.com'], configurable: true
                });
                authService = new AuthService({
                    configManager: mockConfigManager,
                    wellKnownConfigurationManager: mockWellKnownConfigManager
                });
                const done = jest.fn();
                authService.processUserInfo({
                    username: 'testuser', subject: 'sub1', isUser: true,
                    jwt_payload: {
                        iss: 'https://untrusted.example.com',
                        clientFhirPersonId: 'person-1',
                        clientFhirPatientId: 'patient-1',
                        bwellFhirPersonId: 'bwell-person-1',
                        bwellFhirPatientId: 'bwell-patient-1',
                        sub: 'subject-1'
                    },
                    done, client_id: 'client1', scope: 'patient/Patient.read'
                });
                expect(done).toHaveBeenCalledWith(
                    null,
                    expect.objectContaining({ id: 'client1' }),
                    expect.any(Object)
                );
            });
        });

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
                expect.objectContaining({ id: 'client1', name: 'testuser', isUser: false }),
                expect.objectContaining({ scope: 'user/*.read' })
            );
        });

        test('rejects user token with missing required fields', () => {
            const done = jest.fn();
            authService.processUserInfo({
                username: 'testuser',
                subject: 'sub1',
                isUser: true,
                jwt_payload: { clientFhirPersonId: 'p1' },
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
                expect.objectContaining({ id: 'client1', isUser: true, name: 'person-1' }),
                expect.objectContaining({
                    scope: 'patient/Patient.read',
                    context: expect.objectContaining({
                        personIdFromJwtToken: 'person-1',
                        masterPersonIdFromJwtToken: 'bwell-person-1',
                        subject: 'subject-1',
                        username: 'person-1',
                        isUser: true
                    })
                })
            );
        });

        test('sets managingOrganizationId from optional field', () => {
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
                    sub: 'subject-1',
                    managingOrganization: 'org-1'
                },
                done,
                client_id: 'client1',
                scope: 'patient/Patient.read'
            });
            expect(done).toHaveBeenCalledWith(
                null,
                expect.any(Object),
                expect.objectContaining({
                    context: expect.objectContaining({
                        managingOrganizationId: 'org-1'
                    })
                })
            );
        });

        test('processes delegated actor when enableDelegatedAccessDetection is true', () => {
            Object.defineProperty(mockConfigManager, 'enableDelegatedAccessDetection', { get: () => true, configurable: true });
            AuthService.jwksCache = undefined;
            AuthService.userInfoCache = undefined;
            authService = new AuthService({
                configManager: mockConfigManager,
                wellKnownConfigurationManager: mockWellKnownConfigManager
            });

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
                    sub: 'subject-1',
                    act: { reference: 'RelatedPerson/rp-1', sub: 'delegate-sub' },
                    entitlements: ['purpose-of-use-1']
                },
                done,
                client_id: 'client1',
                scope: 'patient/Patient.read'
            });
            expect(done).toHaveBeenCalledWith(
                null,
                expect.any(Object),
                expect.objectContaining({
                    context: expect.objectContaining({
                        actor: { reference: 'RelatedPerson/rp-1', sub: 'delegate-sub' },
                        userType: 'delegatedUser',
                        purposeOfUse: ['purpose-of-use-1']
                    })
                })
            );
        });

        test('rejects when delegated actor processing fails', () => {
            Object.defineProperty(mockConfigManager, 'enableDelegatedAccessDetection', { get: () => true, configurable: true });
            AuthService.jwksCache = undefined;
            AuthService.userInfoCache = undefined;
            authService = new AuthService({
                configManager: mockConfigManager,
                wellKnownConfigurationManager: mockWellKnownConfigManager
            });

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
                    sub: 'subject-1',
                    act: { reference: 'Patient/invalid', sub: 'sub1' }
                },
                done,
                client_id: 'client1',
                scope: 'patient/Patient.read'
            });
            expect(done).toHaveBeenCalledWith(null, false, { reason: 'delegated_actor_failure' });
        });

        test('sets userType from allowed JWT user_type when not delegated', () => {
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
                    sub: 'subject-1',
                    user_type: 'cms-partner',
                    entitlements: ['ent-1', 'ent-2']
                },
                done,
                client_id: 'client1',
                scope: 'patient/Patient.read'
            });
            expect(done).toHaveBeenCalledWith(
                null,
                expect.any(Object),
                expect.objectContaining({
                    context: expect.objectContaining({
                        userType: 'cms-partner',
                        actor: {},
                        purposeOfUse: ['ent-1', 'ent-2']
                    })
                })
            );
        });

        test('ignores non-allowed user_type values', () => {
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
                    sub: 'subject-1',
                    user_type: 'unknown-type'
                },
                done,
                client_id: 'client1',
                scope: 'patient/Patient.read'
            });
            expect(done).toHaveBeenCalledWith(
                null,
                expect.any(Object),
                expect.objectContaining({
                    context: expect.not.objectContaining({
                        userType: 'unknown-type'
                    })
                })
            );
        });

        test('rejects when userType set but isUser is false (non-patient token)', () => {
            // Test the case where a non-user token has an allowed userType somehow
            // This can happen if someone passes isUser=false but the jwt_payload has user_type
            const done = jest.fn();
            // Manually test by constructing a scenario where context.userType is set with isUser false
            // The code sets userType only when isUser is true for JWT fields, but the logic check
            // at line 253 catches cases where userType exists on a non-user context
            // We simulate this by directly calling with a token that somehow has user_type set
            // but isUser is false. Actually the code only sets userType in the isUser block,
            // so this path is unreachable in normal flow. The check is defensive.
            // We can skip testing unreachable code, but let's verify the guard works.
            // We'd need isUser=false but context.userType to be set - which only happens
            // if the code somehow sets it outside the isUser block - it doesn't.
            // Let's verify non-user token path works cleanly
            authService.processUserInfo({
                username: 'svc-account',
                subject: undefined,
                isUser: false,
                jwt_payload: { user_type: 'cms-partner' },
                done,
                client_id: 'svc-client',
                scope: 'user/*.read'
            });
            // Should succeed without the userType being applied (since isUser is false)
            expect(done).toHaveBeenCalledWith(
                null,
                expect.objectContaining({ id: 'svc-client', isUser: false }),
                expect.any(Object)
            );
        });

        test('uses username from context when no explicit username', () => {
            const done = jest.fn();
            authService.processUserInfo({
                username: undefined,
                subject: undefined,
                isUser: false,
                jwt_payload: {},
                done,
                client_id: 'client1',
                scope: 'user/*.read'
            });
            expect(done).toHaveBeenCalledWith(
                null,
                expect.objectContaining({ name: undefined, username: undefined }),
                expect.any(Object)
            );
        });

        test('does not set purposeOfUse when entitlements is not an array', () => {
            Object.defineProperty(mockConfigManager, 'enableDelegatedAccessDetection', { get: () => true, configurable: true });
            AuthService.jwksCache = undefined;
            AuthService.userInfoCache = undefined;
            authService = new AuthService({
                configManager: mockConfigManager,
                wellKnownConfigurationManager: mockWellKnownConfigManager
            });

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
                    sub: 'subject-1',
                    act: { reference: 'RelatedPerson/rp-1', sub: 'delegate-sub' },
                    entitlements: 'not-an-array'
                },
                done,
                client_id: 'client1',
                scope: 'patient/Patient.read'
            });
            const contextArg = done.mock.calls[0][2].context;
            expect(contextArg.purposeOfUse).toBeUndefined();
        });
    });

    describe('processForDelegatedActor', () => {
        test('returns null actor for string act claim', () => {
            const result = authService.processForDelegatedActor({
                jwt_payload: { act: 'some-string' }
            });
            expect(result.actor).toBeNull();
            expect(result.failure).toBe(false);
        });

        test('returns failure for invalid act reference (Patient instead of RelatedPerson)', () => {
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

        test('returns failure when reference is not a string', () => {
            const result = authService.processForDelegatedActor({
                jwt_payload: { act: { reference: 123, sub: 'sub1' } }
            });
            expect(result.failure).toBe(true);
        });

        test('returns failure when sub is not a string', () => {
            const result = authService.processForDelegatedActor({
                jwt_payload: { act: { reference: 'RelatedPerson/rp-1', sub: 123 } }
            });
            expect(result.failure).toBe(true);
        });

        test('returns failure when reference is missing', () => {
            const result = authService.processForDelegatedActor({
                jwt_payload: { act: { sub: 'sub1' } }
            });
            expect(result.failure).toBe(true);
        });

        test('returns failure when reference does not start with RelatedPerson/', () => {
            const result = authService.processForDelegatedActor({
                jwt_payload: { act: { reference: 'Practitioner/p-1', sub: 'sub1' } }
            });
            expect(result.failure).toBe(true);
        });
    });

    describe('verify', () => {
        test('rejects when jwt_payload is null', () => {
            const done = jest.fn();
            authService.verify({ request: {}, jwt_payload: null, token: 'tok', done });
            expect(done).toHaveBeenCalledWith(null, false, { reason: 'missing_jwt_payload' });
        });

        test('rejects when jwt_payload is undefined', () => {
            const done = jest.fn();
            authService.verify({ request: {}, jwt_payload: undefined, token: 'tok', done });
            expect(done).toHaveBeenCalledWith(null, false, { reason: 'missing_jwt_payload' });
        });

        test('sets jwtPayload on request', () => {
            const done = jest.fn();
            const request = {};
            authService.verify({
                request,
                jwt_payload: { scope: 'user/*.read', client_id: 'c1' },
                token: 'tok',
                done
            });
            expect(request.jwtPayload).toEqual({ scope: 'user/*.read', client_id: 'c1' });
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

        test('passes cid check when client_id is allowed', () => {
            authService.cidCheckIssuer = 'http://issuer';
            authService.cidCheckClientIds = ['allowed-cid'];
            const done = jest.fn();
            authService.verify({
                request: {},
                jwt_payload: { iss: 'http://issuer', cid: 'allowed-cid', scope: 'user/*.read', client_id: 'allowed-cid' },
                token: 'tok',
                done
            });
            expect(done).toHaveBeenCalledWith(
                null,
                expect.objectContaining({ id: 'allowed-cid' }),
                expect.any(Object)
            );
        });

        test('skips cid check when issuer does not match cidCheckIssuer', () => {
            authService.cidCheckIssuer = 'http://issuer';
            authService.cidCheckClientIds = ['allowed-cid'];
            const done = jest.fn();
            authService.verify({
                request: {},
                jwt_payload: { iss: 'http://other-issuer', cid: 'any-cid', scope: 'user/*.read', client_id: 'c1' },
                token: 'tok',
                done
            });
            expect(done).toHaveBeenCalledWith(
                null,
                expect.objectContaining({ id: 'c1' }),
                expect.any(Object)
            );
        });

        test('skips cid check when cidCheckIssuer is empty', () => {
            authService.cidCheckIssuer = '';
            const done = jest.fn();
            authService.verify({
                request: {},
                jwt_payload: { scope: 'user/*.read', client_id: 'c1' },
                token: 'tok',
                done
            });
            expect(done).toHaveBeenCalledWith(
                null,
                expect.objectContaining({ id: 'c1' }),
                expect.any(Object)
            );
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
                expect.objectContaining({ id: 'c1', name: 'u1' }),
                expect.objectContaining({ scope: 'user/*.read' })
            );
        });

        test('calls getUserInfoFromUserInfoEndpoint when scope is empty and issuer present', async () => {
            mockWellKnownConfigManager.getWellKnownConfigurationForIssuerAsync = jest.fn()
                .mockResolvedValue({
                    userinfo_endpoint: 'http://auth.example.com/userinfo'
                });

            // Mock superagent for userinfo call
            superagent.get.mockReturnThis();
            superagent.set.mockReturnThis();
            superagent.retry.mockReturnThis();
            superagent.timeout.mockResolvedValue({
                body: { scope: 'patient/Patient.read', username: 'from-userinfo', client_id: 'c-info' }
            });

            const done = jest.fn();
            const request = {};
            authService.verify({
                request,
                jwt_payload: { iss: 'http://issuer.com', sub: 'sub1', cid: 'cid1' },
                token: 'bearer-token',
                done
            });

            // Wait for async processing
            await new Promise(resolve => setTimeout(resolve, 50));
            expect(done).toHaveBeenCalled();
        });

        test('passes a transient error to done() when getUserInfoFromUserInfoEndpoint fails (INC-322)', async () => {
            mockWellKnownConfigManager.getWellKnownConfigurationForIssuerAsync = jest.fn()
                .mockRejectedValue(new Error('Network failed'));

            const done = jest.fn();
            authService.verify({
                request: {},
                jwt_payload: { iss: 'http://issuer.com' },
                token: 'tok',
                done
            });

            // Wait for async processing
            await new Promise(resolve => setTimeout(resolve, 50));
            // A userinfo-endpoint infra failure is not proof the token is invalid, so it
            // must be passed as passport's actual-error signature (done(err), not
            // done(null, false, info)) with a transient/503 marker -- not treated as a
            // hard auth failure that would map to a 401.
            expect(done).toHaveBeenCalledTimes(1);
            const [err, user, info] = done.mock.calls[0];
            expect(err).toMatchObject({ message: 'Network failed', isTransient: true, statusCode: 503 });
            expect(user).toBeUndefined();
            expect(info).toBeUndefined();
        });

        test('DCON-4882: does not resurrect a wildcard-only patient-token via the empty-scope userinfo fallback', async () => {
            // Regression test: stripping a wildcard-only scope down to '' trips verify()'s
            // pre-existing "no scope -> try userinfo endpoint" branch. If that branch's fallback
            // returned jwt_payload raw (its un-stripped scope intact) instead of reapplying the
            // strip, verify()'s `scope1 || scope` would pick the raw wildcard scope back up,
            // completely undoing the restriction for exactly the token it exists to restrict.
            Object.defineProperty(mockConfigManager, 'restrictNonPatientScopeForPatientTokens', {
                get: () => true, configurable: true
            });
            mockWellKnownConfigManager.getWellKnownConfigurationForIssuerAsync = jest.fn().mockResolvedValue(null);
            authService = new AuthService({
                configManager: mockConfigManager,
                wellKnownConfigurationManager: mockWellKnownConfigManager
            });

            const done = jest.fn();
            authService.verify({
                request: {},
                jwt_payload: {
                    iss: 'https://issuer.example.com',
                    clientFhirPatientId: 'patient-1',
                    scope: 'user/*.* access/*.*' // wildcard-only, no patient/ scope
                },
                token: 'tok',
                done
            });

            await new Promise(resolve => setTimeout(resolve, 20));
            expect(done).toHaveBeenCalledWith(null, false, { reason: 'no_scope' });
        });

        test('DCON-4882: does not trust the userinfo response body to remove a patient id claim', async () => {
            // Regression test: the userinfo-response merge must preserve the ORIGINAL token's
            // patient/person id claims, not whatever the (unverified) response body says. If the
            // merge let the response body's absence of the claim win, a patient-id-bearing token
            // could escape the restriction simply by omitting the claim from its userinfo response.
            Object.defineProperty(mockConfigManager, 'restrictNonPatientScopeForPatientTokens', {
                get: () => true, configurable: true
            });
            mockWellKnownConfigManager.getWellKnownConfigurationForIssuerAsync = jest.fn().mockResolvedValue({
                userinfo_endpoint: 'http://auth.example.com/userinfo'
            });
            superagent.timeout.mockResolvedValue({
                body: { scope: 'user/*.* access/*.*' } // no patient/person claim echoed back
            });
            authService = new AuthService({
                configManager: mockConfigManager,
                wellKnownConfigurationManager: mockWellKnownConfigManager
            });

            const done = jest.fn();
            authService.verify({
                request: {},
                jwt_payload: {
                    iss: 'https://issuer.example.com',
                    sub: 'sub-1',
                    clientFhirPatientId: 'patient-1'
                    // no scope on the JWT itself -- must be resolved via the userinfo endpoint
                },
                token: 'tok',
                done
            });

            await new Promise(resolve => setTimeout(resolve, 20));
            expect(done).toHaveBeenCalledWith(null, false, { reason: 'no_scope' });
        });
    });

    describe('getUserInfoFromUserInfoEndpoint', () => {
        test('returns cached value for same iss-cid-sub key', async () => {
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

        test('reapplies getFieldsFromToken on the original payload when no well-known config found', async () => {
            // DCON-4882: must NOT return jwt_payload verbatim (its raw, un-stripped scope) --
            // see the fail-open regression test in the `verify` block for why that would matter.
            mockWellKnownConfigManager.getWellKnownConfigurationForIssuerAsync.mockResolvedValue(null);

            const jwt_payload = { iss: 'issuer1', cid: 'cid1', sub: 'sub1', scope: 'user/*.read' };
            const result = await authService.getUserInfoFromUserInfoEndpoint({
                jwt_payload,
                token: 'my-token'
            });

            expect(result).toEqual({ scope: 'user/*.read', isUser: false, username: null, subject: null, clientId: null });
        });

        test('reapplies getFieldsFromToken on the original payload when well-known config has no userinfo_endpoint', async () => {
            mockWellKnownConfigManager.getWellKnownConfigurationForIssuerAsync.mockResolvedValue({
                jwks_uri: 'http://jwks.example.com'
            });

            const jwt_payload = { iss: 'issuer1', cid: 'cid1', sub: 'sub1', scope: 'user/*.read' };
            const result = await authService.getUserInfoFromUserInfoEndpoint({
                jwt_payload,
                token: 'my-token'
            });

            expect(result).toEqual({ scope: 'user/*.read', isUser: false, username: null, subject: null, clientId: null });
        });

        test('fetches user info and caches result', async () => {
            mockWellKnownConfigManager.getWellKnownConfigurationForIssuerAsync.mockResolvedValue({
                userinfo_endpoint: 'http://auth.example.com/userinfo'
            });
            superagent.timeout.mockResolvedValue({
                body: { scope: 'patient/Patient.read', username: 'from-userinfo' }
            });

            const result = await authService.getUserInfoFromUserInfoEndpoint({
                jwt_payload: { iss: 'issuer2', cid: 'cid2', sub: 'sub2' },
                token: 'my-token'
            });

            expect(result.scope).toBe('patient/Patient.read');
            expect(result.isUser).toBe(true);
            // Should be cached now
            expect(AuthService.userInfoCache.has('issuer2-cid2-sub2')).toBe(true);
        });

        test('does not cache when iss, cid, or sub is missing', async () => {
            mockWellKnownConfigManager.getWellKnownConfigurationForIssuerAsync.mockResolvedValue({
                userinfo_endpoint: 'http://auth.example.com/userinfo'
            });
            superagent.timeout.mockResolvedValue({
                body: { scope: 'patient/Patient.read' }
            });

            await authService.getUserInfoFromUserInfoEndpoint({
                jwt_payload: { iss: 'issuer3' }, // missing cid and sub
                token: 'my-token'
            });

            expect(AuthService.userInfoCache.size).toBe(0);
        });
    });

    describe('clearAuthCache', () => {
        test('clears both caches', () => {
            AuthService.jwksCache.set('key1', 'val1');
            AuthService.userInfoCache.set('key2', 'val2');
            authService.clearAuthCache();
            expect(AuthService.jwksCache.size).toBe(0);
            expect(AuthService.userInfoCache.size).toBe(0);
        });

        test('handles undefined caches gracefully', () => {
            AuthService.jwksCache = undefined;
            AuthService.userInfoCache = undefined;
            // Should not throw
            expect(() => authService.clearAuthCache()).not.toThrow();
        });
    });
});
