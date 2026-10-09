const { describe, test, expect, beforeEach, jest } = require('@jest/globals');
const { ScopesValidator } = require('../../../../operations/security/scopesValidator');
const { ScopesManager } = require('../../../../operations/security/scopesManager');
const { PatientScopeManager } = require('../../../../operations/security/patientScopeManager');
const { DatabaseQueryFactory } = require('../../../../dataLayer/databaseQueryFactory');
const { PersonToPatientIdsExpander } = require('../../../../utils/personToPatientIdsExpander');
const { PatientFilterManager } = require('../../../../fhir/patientFilterManager');
const { FhirLoggingManager } = require('../../../../operations/common/fhirLoggingManager');
const { ConfigManager } = require('../../../../utils/configManager');
const { PreSaveManager } = require('../../../../preSaveHandlers/preSave');
const { DelegatedAccessScopeManager } = require('../../../../operations/security/delegatedAccessScopeManager');

function createMockInstance(ClassType) {
    return Object.create(ClassType.prototype);
}

// the person's own proxy-patient reference, as the server stamps it on create
const ownerRef = (personId) => ({ reference: `Patient/person.${personId}` });
const binary = (securityContext) => ({
    resourceType: 'Binary',
    id: 'b1',
    meta: { security: [] },
    ...(securityContext ? { securityContext } : {})
});

// Scope shapes (see the Binary design doc, section 5)
const PATIENT_WRITE = 'patient/Binary.write';
const PATIENT_READ = 'patient/Binary.read';
const PATIENT_ALL = 'patient/*.*';
const MIXED_VIEWER = 'access/*.* patient/*.* user/*.* admin/*.read';
const SYSTEM = 'system/*.* access/client.*';
const USER = 'user/*.* access/client.*';

describe('Binary person securityContext: scope handling', () => {
    let flag;
    let scopesManager;
    let scopesValidator;
    let patientScopeManager;

    beforeEach(() => {
        flag = true;
        const configManager = createMockInstance(ConfigManager);
        Object.defineProperty(configManager, 'enablePatientScopedBinaryCreate', { get: () => flag, configurable: true });
        Object.defineProperty(configManager, 'enableSmartV2CrudsScopes', { get: () => false, configurable: true });
        Object.defineProperty(configManager, 'enableDelegatedAccessDetection', { get: () => false, configurable: true });

        const patientFilterManager = new PatientFilterManager();
        scopesManager = new ScopesManager({ configManager, patientFilterManager });

        patientScopeManager = new PatientScopeManager({
            databaseQueryFactory: createMockInstance(DatabaseQueryFactory),
            personToPatientIdsExpander: createMockInstance(PersonToPatientIdsExpander),
            scopesManager,
            patientFilterManager
        });

        const fhirLoggingManager = createMockInstance(FhirLoggingManager);
        fhirLoggingManager.logOperationFailureAsync = jest.fn().mockResolvedValue(undefined);
        scopesValidator = new ScopesValidator({
            scopesManager,
            fhirLoggingManager,
            configManager,
            patientScopeManager,
            preSaveManager: createMockInstance(PreSaveManager),
            delegatedAccessScopeManager: createMockInstance(DelegatedAccessScopeManager)
        });
    });

    describe('PatientFilterManager', () => {
        test('Binary is a securityContext-owned resource but NOT patient-filterable', () => {
            const pfm = new PatientFilterManager();
            expect(pfm.isPersonSecurityContextResource({ resourceType: 'Binary' })).toBe(true);
            expect(pfm.isPersonSecurityContextResource({ resourceType: 'Condition' })).toBe(false);
            expect(pfm.getPersonSecurityContextProperty({ resourceType: 'Binary' })).toBe('securityContext.reference');
            expect(pfm.getPersonSecurityContextProperty({ resourceType: 'Condition' })).toBeUndefined();
            expect(pfm.canAccessResourceWithPatientScope({ resourceType: 'Binary' })).toBe(false);
        });
    });

    describe('ScopesManager predicates', () => {
        test.each([
            [PATIENT_WRITE, true],
            [PATIENT_ALL, true],
            [MIXED_VIEWER, true],
            ['PATIENT/Binary.write', true], // case-insensitive, same as isUser
            [SYSTEM, false],
            [USER, false],
            ['access/*.*', false]
        ])('isPersonContextResourceScoped(%s) = %s', (scope, expected) => {
            expect(scopesManager.isPersonContextResourceScoped({ scope, resourceType: 'Binary' })).toBe(expected);
        });

        test('only applies to Binary', () => {
            expect(scopesManager.isPersonContextResourceScoped({ scope: PATIENT_ALL, resourceType: 'Condition' })).toBe(false);
        });

        test('is off when the flag is off', () => {
            flag = false;
            expect(scopesManager.isPersonContextResourceScoped({ scope: PATIENT_WRITE, resourceType: 'Binary' })).toBe(false);
            expect(scopesManager.isPatientScopedPersonContextCreate({ scope: PATIENT_WRITE, resourceType: 'Binary', action: 'create' })).toBe(false);
            expect(scopesManager.isPersonContextStrictAccess({ scope: PATIENT_READ, resourceType: 'Binary' })).toBe(false);
        });

        test('is false without a scope', () => {
            expect(scopesManager.isPersonContextResourceScoped({ scope: undefined, resourceType: 'Binary' })).toBe(false);
        });

        test('isPatientScopedPersonContextCreate only for the create interaction', () => {
            const args = { scope: PATIENT_WRITE, resourceType: 'Binary' };
            expect(scopesManager.isPatientScopedPersonContextCreate({ ...args, action: 'create' })).toBe(true);
            for (const action of ['update', 'patch', 'remove', 'merge', 'search', 'searchById', undefined]) {
                expect(scopesManager.isPatientScopedPersonContextCreate({ ...args, action })).toBe(false);
            }
        });

        test('strict access = patient-scoped with no user/ or system/ scope', () => {
            expect(scopesManager.isPersonContextStrictAccess({ scope: PATIENT_READ, resourceType: 'Binary' })).toBe(true);
            expect(scopesManager.isPersonContextStrictAccess({ scope: `${PATIENT_READ} access/client.*`, resourceType: 'Binary' })).toBe(true);
            expect(scopesManager.isPersonContextStrictAccess({ scope: MIXED_VIEWER, resourceType: 'Binary' })).toBe(false);
            expect(scopesManager.isPersonContextStrictAccess({ scope: `${PATIENT_READ} system/*.read`, resourceType: 'Binary' })).toBe(false);
            expect(scopesManager.isPersonContextStrictAccess({ scope: `${PATIENT_READ} user/Condition.read`, resourceType: 'Binary' })).toBe(false);
        });

        test('create skips the access-tag checks for a patient-scoped Binary create only', () => {
            const res = binary(ownerRef('A'));
            // create by a patient-scoped caller: allowed without access scopes
            expect(scopesManager.isAccessToResourceAllowedBySecurityTags({
                resource: res, user: 'u', scope: PATIENT_WRITE, accessRequested: 'write', isCreate: true
            })).toBe(true);
            expect(scopesManager.isAccessTagChangeAllowedByScopes({
                oldAccessCodes: [], newAccessCodes: ['other-tenant'], resourceType: 'Binary', user: 'u',
                scope: PATIENT_WRITE, isCreate: true
            })).toBe(true);
            // not on a non-create: falls through to the access-code requirement
            expect(() => scopesManager.isAccessToResourceAllowedBySecurityTags({
                resource: res, user: 'u', scope: PATIENT_WRITE, accessRequested: 'write', isCreate: false
            })).toThrow();
            expect(scopesManager.isAccessTagChangeAllowedByScopes({
                oldAccessCodes: [], newAccessCodes: ['other-tenant'], resourceType: 'Binary', user: 'u',
                scope: PATIENT_WRITE, isCreate: false
            })).toBe(false);
        });

        test('flag off: create keeps requiring access scopes', () => {
            flag = false;
            expect(() => scopesManager.isAccessToResourceAllowedBySecurityTags({
                resource: binary(), user: 'u', scope: PATIENT_WRITE, accessRequested: 'write', isCreate: true
            })).toThrow();
        });
    });

    describe('ScopesValidator.isScopesValidAsync (the scope gate)', () => {
        const check = (scope, action, accessRequested) => scopesValidator.isScopesValidAsync({
            requestInfo: { user: 'u', scope },
            resourceType: 'Binary',
            action,
            accessRequested
        });

        test('create: patient/Binary.write is allowed with no access code', async () => {
            expect(await check(PATIENT_WRITE, 'create', 'write')).toBeUndefined();
        });

        test('create: patient/*.* is allowed', async () => {
            expect(await check(PATIENT_ALL, 'create', 'write')).toBeUndefined();
        });

        test('create: a patient read-only scope is not enough (T23)', async () => {
            const result = await check(PATIENT_READ, 'create', 'write');
            expect(result).toBeDefined();
            expect(result.statusCode).toBe(403);
        });

        test('create: a system/user scope alone cannot stand in for the patient grant on a mixed token (T22)', async () => {
            const result = await check('patient/Condition.write system/*.* access/client.*', 'create', 'write');
            expect(result).toBeDefined();
            expect(result.statusCode).toBe(403);
        });

        test('create: mixed token holding the patient create grant is allowed (treated as patient-scoped)', async () => {
            expect(await check(`${PATIENT_WRITE} system/*.* access/client.*`, 'create', 'write')).toBeUndefined();
        });

        test.each(['update', 'patch', 'remove', 'merge'])('%s of Binary stays forbidden for a patient scope (T5-T8)', async (action) => {
            const result = await check(PATIENT_WRITE, action, 'write');
            expect(result).toBeDefined();
            expect(result.statusCode).toBe(403);
            expect(result.message).toContain('Write not allowed using user scopes if patient scope is present');
        });

        test('create without the flag is rejected exactly as today (T31)', async () => {
            flag = false;
            const result = await check(PATIENT_WRITE, 'create', 'write');
            expect(result).toBeDefined();
            expect(result.statusCode).toBe(403);
            expect(result.message).toContain('Write not allowed using user scopes if patient scope is present');
        });

        test('system/user tokens without a patient scope are unchanged', async () => {
            expect(await check(SYSTEM, 'create', 'write')).toBeUndefined();
            expect(await check(USER, 'create', 'write')).toBeUndefined();
        });

        test('read: pure patient token with patient/Binary.read is allowed without an access code (T37)', async () => {
            expect(await check(PATIENT_READ, 'searchById', 'read')).toBeUndefined();
            expect(await check(PATIENT_READ, 'search', 'read')).toBeUndefined();
        });

        test('read: pure patient token without a Binary grant is rejected (T40)', async () => {
            const result = await check('patient/Condition.read', 'searchById', 'read');
            expect(result).toBeDefined();
            expect(result.statusCode).toBe(403);
        });

        test('read: patient token with a user scope keeps today\'s evaluation (needs an access code)', async () => {
            // user scope present -> not strict -> evaluated through user/system scopes as before
            expect((await check('patient/Binary.read user/*.read', 'searchById', 'read')).statusCode).toBe(403);
            expect(await check('patient/Binary.read user/*.read access/client.*', 'searchById', 'read')).toBeUndefined();
            expect(await check(MIXED_VIEWER, 'searchById', 'read')).toBeUndefined();
        });

        test('read without the flag: a pure patient token still cannot read Binary (today)', async () => {
            flag = false;
            const result = await check(PATIENT_READ, 'searchById', 'read');
            expect(result).toBeDefined();
            expect(result.statusCode).toBe(403);
        });
    });

    describe('PatientScopeManager.canWriteResourceAsync for a Binary create', () => {
        const write = (resource, personIdFromJwtToken, extra = {}) => patientScopeManager.canWriteResourceAsync({
            base_version: '4_0_0',
            isUser: true,
            personIdFromJwtToken,
            resource,
            scope: PATIENT_WRITE,
            user: 'u',
            isCreate: true,
            ...extra
        });

        test('allows a create owned by the caller\'s own person', async () => {
            expect(await write(binary(ownerRef('A')), 'A')).toBe(true);
        });

        test('denies a create owned by another person (T3)', async () => {
            expect(await write(binary(ownerRef('B')), 'A')).toBe(false);
        });

        test('denies a create with no securityContext, a real patient, or no person id in the token (T4)', async () => {
            expect(await write(binary(), 'A')).toBe(false);
            expect(await write(binary({ reference: 'Patient/A' }), 'A')).toBe(false);
            expect(await write(binary(ownerRef('A')), undefined)).toBe(false);
            expect(await write(binary(ownerRef('A')), '')).toBe(false);
        });

        test('a non-create write of Binary is denied (Binary is not patient-filterable)', async () => {
            expect(await write(binary(ownerRef('A')), 'A', { isCreate: false })).toBe(false);
        });

        test('flag off: denied exactly as today', async () => {
            flag = false;
            expect(await write(binary(ownerRef('A')), 'A')).toBe(false);
        });

        test('a token without any patient scope is not affected', async () => {
            expect(await write(binary(), 'A', { scope: SYSTEM })).toBe(true);
        });
    });
});
