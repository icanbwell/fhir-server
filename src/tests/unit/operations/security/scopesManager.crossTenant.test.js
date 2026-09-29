const { describe, test, expect, beforeEach, jest: jestGlobal } = require('@jest/globals');

/**
 * Regression coverage for the access-tag-change gap in ScopesManager.isAccessTagChangeAllowedByScopes.
 *
 * A prior version of this file asserted that ScopesManager.isAccessToResourceAllowedBySecurityTags
 * must independently reject a cross-tenant resource for a patient-scoped caller. That method's
 * patient-scope short-circuit is intentional and load-bearing: patient-scoped tokens never carry an
 * access/ scope to compare against, and every real caller (create/update/patch/merge/remove) pairs
 * it with patientScopeManager.canWriteResourceAsync, which independently enforces identity-graph
 * ownership - see scopesManager.test.js's own "isAccessToResourceAllowedBySecurityTags" describe
 * block, which already asserts the short-circuit as correct behavior. Tightening it here would
 * deny every patient-scoped write, not just malicious ones.
 *
 * The actual, previously-unguarded gap lives one level up: isAccessTagChangeAllowedByScopes (the
 * method whose entire job is comparing a write's old vs. new meta.security access tags) had the
 * same unconditional patient-scope short-circuit, with nothing else in the write-authorization
 * chain checking tag legitimacy. On a CREATE that's fine - there's no pre-existing tenant's
 * visibility to silently grant or revoke (ownership is still covered by canWriteResourceAsync). On
 * a write to an EXISTING resource, changing its tags always grants or revokes some tenant's
 * visibility of data that already existed, so it must go through the same access-code comparison
 * any other caller is held to. This file covers that update-path case.
 */
jestGlobal.mock('../../../../utils/assertType', () => ({
    assertIsValid: () => {},
    assertTypeEquals: () => {}
}));

const { ScopesManager } = require('../../../../operations/security/scopesManager');

describe('ScopesManager — Cross-Tenant Security (isAccessTagChangeAllowedByScopes)', () => {
    let scopesManager;

    beforeEach(() => {
        const mockConfigManager = { authEnabled: true };
        const mockPatientFilterManager = {
            canAccessResourceWithPatientScope: jestGlobal.fn().mockReturnValue(true),
            getPatientPropertyForResource: jestGlobal.fn().mockReturnValue('subject.reference')
        };
        scopesManager = new ScopesManager({
            configManager: mockConfigManager,
            patientFilterManager: mockPatientFilterManager
        });
    });

    describe('writing to an EXISTING resource (isCreate: false)', () => {
        test('CRITICAL: patient-scoped caller must NOT add a foreign tenant access tag to an existing resource', () => {
            const result = scopesManager.isAccessTagChangeAllowedByScopes({
                oldAccessCodes: ['my_clinic'],
                newAccessCodes: ['my_clinic', 'other_tenant'],
                resourceType: 'Observation',
                user: 'patient-123@my_clinic',
                scope: 'patient/Observation.write',
                isCreate: false
            });

            expect(result).toBe(false);
        });

        test('CRITICAL: patient-scoped caller must NOT remove an existing tenant access tag from an existing resource', () => {
            const result = scopesManager.isAccessTagChangeAllowedByScopes({
                oldAccessCodes: ['my_clinic', 'other_tenant'],
                newAccessCodes: ['my_clinic'],
                resourceType: 'Condition',
                user: 'patient-123@my_clinic',
                scope: 'patient/Condition.write',
                isCreate: false
            });

            expect(result).toBe(false);
        });

        test('a patient scope combined with a matching access scope may still change tags it is authorized for', () => {
            const result = scopesManager.isAccessTagChangeAllowedByScopes({
                oldAccessCodes: ['tenant_a'],
                newAccessCodes: ['tenant_a', 'tenant_b'],
                resourceType: 'Observation',
                user: 'user@tenant_a',
                scope: 'patient/Observation.write access/tenant_a.* access/tenant_b.*',
                isCreate: false
            });

            expect(result).toBe(true);
        });

        test('an update that does not change access tags at all is still allowed', () => {
            const result = scopesManager.isAccessTagChangeAllowedByScopes({
                oldAccessCodes: ['my_clinic'],
                newAccessCodes: ['my_clinic'],
                resourceType: 'Observation',
                user: 'patient-123@my_clinic',
                scope: 'patient/Observation.write',
                isCreate: false
            });

            expect(result).toBe(true);
        });
    });

    describe('creating a NEW resource (isCreate: true) — must remain unaffected by the fix above', () => {
        test('a patient-scoped caller may still set initial access tags on create, with no access/ scope', () => {
            // Mirrors src/tests/patientScope/create_with_patient_scope/fixtures/Condition/condition1.json,
            // which sets two access tags while holding only patient/Condition.write.
            const result = scopesManager.isAccessTagChangeAllowedByScopes({
                oldAccessCodes: [],
                newAccessCodes: ['client', 'B'],
                resourceType: 'Condition',
                user: 'patient-123@example.com',
                scope: 'patient/Condition.write',
                isCreate: true
            });

            expect(result).toBe(true);
        });
    });
});
