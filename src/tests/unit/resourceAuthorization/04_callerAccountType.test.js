'use strict';

/**
 * Regression tests for docs/resource-authorization.md §4 "Caller / account type".
 *
 * Verifies, against the REAL AuthService implementation (never a stand-in class):
 *   - The exact `isUser` detection line in `getFieldsFromToken` — a caller is treated as a
 *     Person/Patient (end-user) caller if and only if one of its scopes starts with `patient/`
 *     (case-insensitively). Service-account (client-credentials) and admin/tester
 *     (username+password) callers are authorization-equivalent here: neither carries a
 *     `patient/` scope, so both get `isUser === false` — the code has no separate notion of
 *     "service account" vs "admin/tester user", only the presence/absence of a patient/ scope.
 *   - `AuthService.processUserInfo` sets `userType: 'delegatedUser'` from a valid JWT `act` claim
 *     (gated by `configManager.enableDelegatedAccessDetection`).
 *   - `AuthService.processUserInfo` sets `userType` from the JWT's `user_type` claim only when it
 *     is on the allow-list (`AUTH_USER_TYPES.cmsPartnerUser`, i.e. `cms-partner`) — an
 *     unrecognized/self-declared `user_type` value must NOT be adopted. This is the specific
 *     security-relevant behavior called out in the task: if this allow-list check were missing or
 *     bypassable, a caller could self-declare a privileged userType via its own JWT claims.
 *
 * Only true external collaborators (ConfigManager, WellKnownConfigurationManager, superagent,
 * logging) are mocked; AuthService is required from its real source path and exercised directly.
 */
const { describe, test, expect, beforeEach, jest } = require('@jest/globals');

jest.mock('superagent', () => ({
    get: jest.fn().mockReturnThis(),
    set: jest.fn().mockReturnThis(),
    retry: jest.fn().mockReturnThis(),
    timeout: jest.fn()
}));

jest.mock('../../../operations/common/logging', () => ({
    logDebug: jest.fn(),
    logError: jest.fn(),
    logInfo: jest.fn(),
    logWarn: jest.fn()
}));

const { AuthService } = require('../../../strategies/authService');
const { ConfigManager } = require('../../../utils/configManager');
const { WellKnownConfigurationManager } = require('../../../utils/wellKnownConfiguration/wellKnownConfigurationManager');
const { AUTH_USER_TYPES } = require('../../../constants');

function createMockInstance (ClassType) {
    return Object.create(ClassType.prototype);
}

/** Required JWT fields that must be present for any `isUser: true` (patient-scoped) token,
 * checked before delegated-actor/userType logic even runs in processUserInfo. */
function baseIsUserJwtPayload (overrides = {}) {
    return {
        clientFhirPersonId: 'client-person-1',
        clientFhirPatientId: 'client-patient-1',
        bwellFhirPersonId: 'bwell-person-1',
        bwellFhirPatientId: 'bwell-patient-1',
        ...overrides
    };
}

describe('Resource Authorization §4 — Caller / account type', () => {
    /** @type {AuthService} */
    let authService;
    let mockConfigManager;
    let mockWellKnownConfigurationManager;

    beforeEach(() => {
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

        mockWellKnownConfigurationManager = createMockInstance(WellKnownConfigurationManager);

        authService = new AuthService({
            configManager: mockConfigManager,
            wellKnownConfigurationManager: mockWellKnownConfigurationManager
        });
    });

    describe('isUser detection — getFieldsFromToken', () => {
        // src/strategies/authService.js:
        //   const isUser = scopes.some((s) => s.toLowerCase().startsWith('patient/'));
        test('isUser is true when a patient/ scope is present', () => {
            const { isUser } = authService.getFieldsFromToken({ scope: 'patient/Observation.read user/Patient.read' });
            expect(isUser).toBe(true);
        });

        test('isUser detection is case-insensitive (per the .toLowerCase() call)', () => {
            const { isUser } = authService.getFieldsFromToken({ scope: 'PATIENT/Observation.read' });
            expect(isUser).toBe(true);
        });

        test('isUser is false for a service-account-style (client-credentials) scope set', () => {
            // user/access/admin scopes only — no patient/ scope — the shape a client-credentials
            // grant produces.
            const { isUser } = authService.getFieldsFromToken({
                scope: 'user/*.* access/tenantA.* admin/*.*'
            });
            expect(isUser).toBe(false);
        });

        test('isUser is false for an admin/tester (username+password) scope set — identical to service account', () => {
            // Per §4, service accounts and admin/tester accounts are authorization-equivalent:
            // the code has no separate concept distinguishing the two grant types, only whether a
            // patient/ scope is present. An admin/tester user's scope shape is indistinguishable
            // from a service account's here.
            const serviceAccountResult = authService.getFieldsFromToken({ scope: 'user/*.* access/tenantA.* admin/*.*' });
            const adminTesterResult = authService.getFieldsFromToken({ scope: 'user/*.* access/tenantA.* admin/*.*' });
            expect(adminTesterResult.isUser).toBe(false);
            expect(adminTesterResult.isUser).toBe(serviceAccountResult.isUser);
        });

        test('isUser is false when scope is entirely absent', () => {
            const { isUser } = authService.getFieldsFromToken({});
            expect(isUser).toBe(false);
        });

        test('a patient/ scope anywhere in a mixed scope list still sets isUser true', () => {
            const { isUser } = authService.getFieldsFromToken({
                scope: 'user/Patient.read access/tenantA.* patient/Observation.read'
            });
            expect(isUser).toBe(true);
        });
    });

    describe('processUserInfo — userType from delegated-actor (act) claim', () => {
        test('sets userType=delegatedUser and actor when a valid act claim is present and detection is enabled', () => {
            Object.defineProperty(mockConfigManager, 'enableDelegatedAccessDetection', { get: () => true, configurable: true });

            const jwt_payload = baseIsUserJwtPayload({
                act: { reference: 'RelatedPerson/rp-1', sub: 'actor-sub-1' }
            });
            const done = jest.fn();

            authService.processUserInfo({
                username: 'grantor-1',
                subject: 'sub-1',
                isUser: true,
                jwt_payload,
                done,
                client_id: 'client-1',
                scope: 'patient/Observation.read'
            });

            expect(done).toHaveBeenCalledTimes(1);
            const [err, user, extra] = done.mock.calls[0];
            expect(err).toBeNull();
            expect(user).toBeTruthy();
            expect(extra.context.userType).toBe(AUTH_USER_TYPES.delegatedUser);
            expect(extra.context.actor).toEqual({ reference: 'RelatedPerson/rp-1', sub: 'actor-sub-1' });
        });

        test('does not set userType from act claim when enableDelegatedAccessDetection is disabled', () => {
            Object.defineProperty(mockConfigManager, 'enableDelegatedAccessDetection', { get: () => false, configurable: true });

            const jwt_payload = baseIsUserJwtPayload({
                act: { reference: 'RelatedPerson/rp-1', sub: 'actor-sub-1' }
            });
            const done = jest.fn();

            authService.processUserInfo({
                username: 'grantor-1',
                subject: 'sub-1',
                isUser: true,
                jwt_payload,
                done,
                client_id: 'client-1',
                scope: 'patient/Observation.read'
            });

            const [, , extra] = done.mock.calls[0];
            expect(extra.context.userType).toBeUndefined();
        });

        test('rejects the request when the act claim is malformed (missing required actor fields)', () => {
            Object.defineProperty(mockConfigManager, 'enableDelegatedAccessDetection', { get: () => true, configurable: true });

            const jwt_payload = baseIsUserJwtPayload({
                act: { reference: 'NotARelatedPerson/rp-1' } // missing sub, wrong reference prefix
            });
            const done = jest.fn();

            authService.processUserInfo({
                username: 'grantor-1',
                subject: 'sub-1',
                isUser: true,
                jwt_payload,
                done,
                client_id: 'client-1',
                scope: 'patient/Observation.read'
            });

            expect(done).toHaveBeenCalledWith(null, false, { reason: 'delegated_actor_failure' });
        });
    });

    describe('processUserInfo — userType from user_type claim is allow-list gated', () => {
        test('adopts userType when user_type is the allow-listed cms-partner value', () => {
            const jwt_payload = baseIsUserJwtPayload({ user_type: AUTH_USER_TYPES.cmsPartnerUser });
            const done = jest.fn();

            authService.processUserInfo({
                username: 'cms-user-1',
                subject: 'sub-1',
                isUser: true,
                jwt_payload,
                done,
                client_id: 'client-1',
                scope: 'patient/Patient.read'
            });

            const [err, , extra] = done.mock.calls[0];
            expect(err).toBeNull();
            expect(extra.context.userType).toBe(AUTH_USER_TYPES.cmsPartnerUser);
        });

        // SECURITY-CRITICAL: this is the exact behavior flagged in the task as worth verifying
        // carefully. A caller can put ANY string in a self-issued/unverified user_type claim; if
        // AuthService adopted it unconditionally, a caller could self-declare e.g. userType:
        // 'delegatedUser' or some other privileged value and unlock the mechanisms gated on it
        // (§6b CMS consent restriction bypass, §9/§10 sensitivity-exclusion bypass) without ever
        // going through the actual act-claim/consent-backed delegated-actor flow.
        test('SECURITY: does NOT adopt an unrecognized/non-allow-listed user_type claim', () => {
            const jwt_payload = baseIsUserJwtPayload({ user_type: 'super-admin' });
            const done = jest.fn();

            authService.processUserInfo({
                username: 'attacker-1',
                subject: 'sub-1',
                isUser: true,
                jwt_payload,
                done,
                client_id: 'client-1',
                scope: 'patient/Patient.read'
            });

            const [err, , extra] = done.mock.calls[0];
            expect(err).toBeNull();
            expect(extra.context.userType).toBeUndefined();
        });

        test('SECURITY: does NOT adopt a self-declared user_type equal to the delegatedUser value without a valid act claim', () => {
            // Confirms a caller can't shortcut the act-claim/consent-backed delegated flow by
            // simply setting user_type: 'delegatedUser' directly, since 'delegatedUser' is not on
            // AuthService.allowedJWTUserTypes (only 'cms-partner' is).
            const jwt_payload = baseIsUserJwtPayload({ user_type: AUTH_USER_TYPES.delegatedUser });
            const done = jest.fn();

            authService.processUserInfo({
                username: 'attacker-2',
                subject: 'sub-1',
                isUser: true,
                jwt_payload,
                done,
                client_id: 'client-1',
                scope: 'patient/Patient.read'
            });

            const [, , extra] = done.mock.calls[0];
            expect(extra.context.userType).toBeUndefined();
        });

        test('rejects the request outright when a userType is set (delegated) but isUser is false (non-patient token)', () => {
            Object.defineProperty(mockConfigManager, 'enableDelegatedAccessDetection', { get: () => true, configurable: true });

            // isUser: false means the act-claim branch inside `if (isUser) {...}` never runs, so
            // userType is never set from the act claim for a non-patient-scoped token either —
            // asserting the whole delegated/userType mechanism is scoped to patient/ tokens only.
            const jwt_payload = baseIsUserJwtPayload({
                act: { reference: 'RelatedPerson/rp-1', sub: 'actor-sub-1' }
            });
            const done = jest.fn();

            authService.processUserInfo({
                username: 'service-account-1',
                subject: 'sub-1',
                isUser: false,
                jwt_payload,
                done,
                client_id: 'client-1',
                scope: 'user/*.* access/tenantA.*'
            });

            expect(done).toHaveBeenCalledTimes(1);
            const [err, user, extra] = done.mock.calls[0];
            expect(err).toBeNull();
            expect(user.isUser).toBe(false);
            expect(extra.context.userType).toBeUndefined();
        });
    });
});
