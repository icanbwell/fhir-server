/**
 * Tests for ScopesManager cross-tenant security (DCON-4806).
 *
 * isAccessToResourceAllowedBySecurityTags previously returned `true` immediately whenever
 * the caller held a valid patient scope for a patient-filterable resource type, without
 * checking whether the resource's own owner/access tags belonged to a different tenant.
 * Fixed to only skip the tag check when the resource carries no security tags at all;
 * otherwise it falls through to the same tag-matching check every other caller goes through.
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

    describe('isAccessToResourceAllowedBySecurityTags checks resource tags even with a valid patient scope', () => {
        test('patient-scoped user should NOT access resources from other tenants', () => {
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

            const result = scopesManager.isAccessToResourceAllowedBySecurityTags({
                resource,
                user: 'user@alpha_health',
                scope,
                accessRequested: 'read'
            });

            expect(result).toBe(false);
        });

        test('patient-scoped user should NOT access any resource just because type is patient-filterable', () => {
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
