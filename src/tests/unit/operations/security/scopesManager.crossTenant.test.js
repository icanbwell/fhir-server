/**
 * Tests for ScopesManager cross-tenant security gaps
 * These test CORRECT behavior that the code does NOT currently satisfy.
 * All tests FAIL until the bugs are fixed.
 */
const { describe, test, expect, beforeEach, jest: jestGlobal } = require('@jest/globals');

jestGlobal.mock('../../../../utils/assertType', () => ({
    assertIsValid: () => {},
    assertTypeEquals: () => {}
}));

const { ScopesManager } = require('../../../../operations/security/scopesManager');

describe('ScopesManager — Cross-Tenant Security', () => {
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

    describe('BUG: isAccessToResourceAllowedBySecurityTags returns true without checking patient ownership', () => {
        test('CRITICAL: patient-scoped user should NOT access resources from other tenants', () => {
            const scope = 'patient/Observation.read';
            const resource = {
                resourceType: 'Observation',
                meta: {
                    security: [
                        { system: 'https://www.icanbwell.com/owner', code: 'other_tenant' },
                        { system: 'https://www.icanbwell.com/access', code: 'other_tenant' }
                    ]
                }
            };

            // The current code at line 133 returns TRUE without checking whether
            // the resource belongs to the user's patient/tenant. It just sees
            // "patient scope + patient-filterable resource type" and immediately returns true.
            //
            // CORRECT: should return FALSE because resource belongs to 'other_tenant'
            const result = scopesManager.isAccessToResourceAllowedBySecurityTags({
                resource,
                user: 'user@alpha_health',
                scope,
                accessRequested: 'read'
            });

            expect(result).toBe(false);
        });

        test('CRITICAL: patient-scoped user should NOT access any resource just because type is patient-filterable', () => {
            const scope = 'patient/Condition.read';
            const resourceFromAnotherTenant = {
                resourceType: 'Condition',
                meta: {
                    security: [
                        { system: 'https://www.icanbwell.com/owner', code: 'tenant_b' },
                        { system: 'https://www.icanbwell.com/access', code: 'tenant_b' }
                    ]
                }
            };

            const result = scopesManager.isAccessToResourceAllowedBySecurityTags({
                resource: resourceFromAnotherTenant,
                user: 'user@tenant_a',
                scope,
                accessRequested: 'read'
            });

            // CORRECT: must not return true for a resource the user has no access to
            expect(result).not.toBe(true);
        });
    });
});
