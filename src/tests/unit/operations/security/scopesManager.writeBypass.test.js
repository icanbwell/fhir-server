/**
 * Tests for ScopesManager write operation cross-tenant checks (INC-331 / DCON-4806).
 *
 * isAccessToResourceAllowedBySecurityTags previously returned true immediately once it
 * detected a valid patient scope, without verifying the resource's own owner/access tags.
 * Fixed to fall through to the same tag-matching check other callers use whenever the
 * resource carries security tags -- a patient scope alone can no longer grant write access
 * to a resource tagged for a different tenant.
 */
const { describe, test, expect, beforeEach, jest: jestGlobal } = require('@jest/globals');

jestGlobal.mock('../../../../utils/assertType', () => ({
    assertIsValid: () => {},
    assertTypeEquals: () => {}
}));

const { ScopesManager } = require('../../../../operations/security/scopesManager');

describe('ScopesManager — Write Operation Bypass (INC-331)', () => {
    let scopesManager;

    beforeEach(() => {
        const mockConfigManager = {
            authEnabled: true
        };
        const mockPatientFilterManager = {
            canAccessResourceWithPatientScope: jestGlobal.fn().mockReturnValue(true),
            getPatientPropertyForResource: jestGlobal.fn().mockReturnValue('subject.reference')
        };
        scopesManager = new ScopesManager({
            configManager: mockConfigManager,
            patientFilterManager: mockPatientFilterManager
        });
    });

    test('patient/Observation.write should NOT allow writing to another patient record', () => {
        // A user with patient/Observation.write scope for patient "patient-123"
        // attempts to write an Observation that belongs to "patient-456".
        // The resource's security tags indicate it belongs to a different owner.
        const scope = 'patient/Observation.write';
        const resourceBelongingToOtherPatient = {
            resourceType: 'Observation',
            subject: { reference: 'Patient/patient-456' },
            meta: {
                security: [
                    { system: 'https://www.icanbwell.com/owner', code: 'tenant_other' },
                    { system: 'https://www.icanbwell.com/access', code: 'tenant_other' }
                ]
            }
        };

        const result = scopesManager.isAccessToResourceAllowedBySecurityTags({
            resource: resourceBelongingToOtherPatient,
            user: 'patient-123@tenant_mine',
            scope,
            accessRequested: 'write'
        });

        // CORRECT: Must return false because the resource belongs to another patient/tenant
        expect(result).toBe(false);
    });

    test('patient/Condition.write should NOT allow updating resources from another tenant', () => {
        // A user in tenant_a with patient/Condition.write scope should not be able
        // to update a Condition resource owned by tenant_b.
        const scope = 'patient/Condition.write access/tenant_a.*';
        const resourceFromTenantB = {
            resourceType: 'Condition',
            subject: { reference: 'Patient/patient-in-tenant-b' },
            meta: {
                security: [
                    { system: 'https://www.icanbwell.com/owner', code: 'tenant_b' },
                    { system: 'https://www.icanbwell.com/access', code: 'tenant_b' }
                ]
            }
        };

        const result = scopesManager.isAccessToResourceAllowedBySecurityTags({
            resource: resourceFromTenantB,
            user: 'user@tenant_a',
            scope,
            accessRequested: 'write'
        });

        // CORRECT: Must return false because resource security tags (tenant_b)
        // do not match the user's access codes (tenant_a)
        expect(result).toBe(false);
    });

    test('user/* scope combined with patient scope should NOT bypass security tag checks on write', () => {
        // A user who has BOTH user/Observation.write AND patient/Observation.write scopes
        // along with access/tenant_a.* attempts to write a resource owned by tenant_b.
        // The patient scope presence should NOT allow bypassing tenant security tag checks.
        const scope = 'user/Observation.write patient/Observation.write access/tenant_a.*';
        const resourceFromTenantB = {
            resourceType: 'Observation',
            meta: {
                security: [
                    { system: 'https://www.icanbwell.com/owner', code: 'tenant_b' },
                    { system: 'https://www.icanbwell.com/access', code: 'tenant_b' }
                ]
            }
        };

        const result = scopesManager.isAccessToResourceAllowedBySecurityTags({
            resource: resourceFromTenantB,
            user: 'user@tenant_a',
            scope,
            accessRequested: 'write'
        });

        // CORRECT: Must return false because the user's access codes (tenant_a)
        // do not match the resource's security tags (tenant_b)
        expect(result).toBe(false);
    });

    test('write operations should validate security tags match the requesting user access', () => {
        // Even when patient scope is present, a write operation must still validate
        // that the resource's security tags (owner/access) match the user's granted
        // access codes. The patient scope should narrow access, not bypass it entirely.
        const scope = 'patient/Observation.write patient/Condition.write access/my_clinic.*';
        const resourceOwnedByAnotherClinic = {
            resourceType: 'Observation',
            subject: { reference: 'Patient/patient-xyz' },
            meta: {
                security: [
                    { system: 'https://www.icanbwell.com/owner', code: 'other_clinic' },
                    { system: 'https://www.icanbwell.com/access', code: 'other_clinic' }
                ]
            }
        };

        const result = scopesManager.isAccessToResourceAllowedBySecurityTags({
            resource: resourceOwnedByAnotherClinic,
            user: 'doctor@my_clinic',
            scope,
            accessRequested: 'write'
        });

        // CORRECT: Must return false because the resource's security tags (other_clinic)
        // do not match the user's access codes (my_clinic)
        expect(result).toBe(false);
    });
});
