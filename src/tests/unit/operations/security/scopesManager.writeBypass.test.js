const { describe, test, expect, beforeEach, jest: jestGlobal } = require('@jest/globals');

/**
 * Regression coverage for the write-path access-tag-change gap (INC-331 follow-up), companion to
 * scopesManager.crossTenant.test.js. A prior version of this file asserted the same expectation
 * against ScopesManager.isAccessToResourceAllowedBySecurityTags that crossTenant.test.js's own
 * header comment explains is not a live bug - see that file for why. This file exercises
 * isAccessTagChangeAllowedByScopes (the method whose actual job is validating access-tag changes
 * on write) across resource types and scope combinations, and the fix threading isCreate through
 * so create still works.
 */
jestGlobal.mock('../../../../utils/assertType', () => ({
    assertIsValid: () => {},
    assertTypeEquals: () => {}
}));

const { ScopesManager } = require('../../../../operations/security/scopesManager');

describe('ScopesManager — Write Operation Bypass (INC-331)', () => {
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

    test('patient/Observation.write must NOT be able to move an existing resource to another tenant', () => {
        const result = scopesManager.isAccessTagChangeAllowedByScopes({
            oldAccessCodes: ['tenant_mine'],
            newAccessCodes: ['tenant_other'],
            resourceType: 'Observation',
            user: 'patient-123@tenant_mine',
            scope: 'patient/Observation.write',
            isCreate: false
        });

        expect(result).toBe(false);
    });

    test('patient/Condition.write combined with access/tenant_a.* must NOT add an unauthorized tenant_b tag on update', () => {
        const result = scopesManager.isAccessTagChangeAllowedByScopes({
            oldAccessCodes: ['tenant_a'],
            newAccessCodes: ['tenant_a', 'tenant_b'],
            resourceType: 'Condition',
            user: 'user@tenant_a',
            scope: 'patient/Condition.write access/tenant_a.*',
            isCreate: false
        });

        expect(result).toBe(false);
    });

    test('user/* write access does not need patient scope to be present to be denied an unauthorized tag change', () => {
        const result = scopesManager.isAccessTagChangeAllowedByScopes({
            oldAccessCodes: ['my_clinic'],
            newAccessCodes: ['other_clinic'],
            resourceType: 'Observation',
            user: 'doctor@my_clinic',
            scope: 'user/Observation.write access/my_clinic.*',
            isCreate: false
        });

        expect(result).toBe(false);
    });

    test('the wildcard access/*.* code may change any tag, even with a patient scope also present', () => {
        const result = scopesManager.isAccessTagChangeAllowedByScopes({
            oldAccessCodes: ['tenant_a'],
            newAccessCodes: ['tenant_b'],
            resourceType: 'Observation',
            user: 'admin@bwell',
            scope: 'patient/Observation.write access/*.*',
            isCreate: false
        });

        expect(result).toBe(true);
    });

    test('creating a new resource with a patient scope is unaffected by the update-path fix', () => {
        const result = scopesManager.isAccessTagChangeAllowedByScopes({
            oldAccessCodes: [],
            newAccessCodes: ['my_clinic'],
            resourceType: 'Observation',
            user: 'patient-123@my_clinic',
            scope: 'patient/Observation.write',
            isCreate: true
        });

        expect(result).toBe(true);
    });
});
