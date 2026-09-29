/**
 * Tests for merge operation cross-tenant write vulnerabilities.
 *
 * VULNERABILITY: The merge operation's access control has gaps that allow:
 * 1. A patient-scoped user to create/update resources in other tenants because
 *    isAccessToResourceAllowedBySecurityTags returns true without checking tags
 *    when patient scope is present for patient-filterable resource types.
 * 2. A patient-scoped user to write to non-patient-filterable resources
 *    (Organization, Practitioner, etc.) because canWriteResourceAsync returns
 *    true when the resource type is not in patientFilterMapping.
 *
 * Files:
 * - src/operations/security/scopesManager.js (line 128-134)
 * - src/operations/security/patientScopeManager.js (line 286-290)
 * - src/operations/merge/validators/writeAllowedByScopesValidator.js (line 55-60)
 *
 * Exploitation scenario for cross-tenant data injection:
 * 1. Attacker obtains patient-scoped token for tenant_a
 * 2. Attacker sends merge request with resources having owner=tenant_b, access=tenant_b
 * 3. writeAllowedByScopesValidator calls isAccessToResourceAllowedByAccessAndPatientScopes
 * 4. isAccessToResourceAllowedByAccessScopes calls isAccessToResourceAllowedBySecurityTags
 * 5. Bug: returns true because resource type is patient-filterable and patient scope exists
 * 6. Resources are created in tenant_b's namespace
 *
 * Severity: CRITICAL — allows cross-tenant data injection and poisoning
 */
const { describe, test, expect, beforeEach, jest: jestGlobal } = require('@jest/globals');

jestGlobal.mock('../../../../utils/assertType', () => ({
    assertIsValid: () => {},
    assertTypeEquals: () => {}
}));

const { ScopesValidator } = require('../../../../operations/security/scopesValidator');
const { ScopesManager } = require('../../../../operations/security/scopesManager');
const { PatientScopeManager } = require('../../../../operations/security/patientScopeManager');
const { PatientFilterManager } = require('../../../../fhir/patientFilterManager');
const { PreSaveManager } = require('../../../../preSaveHandlers/preSave');
const { FhirLoggingManager } = require('../../../../operations/common/fhirLoggingManager');
const { DelegatedAccessScopeManager } = require('../../../../operations/security/delegatedAccessScopeManager');
const { ConfigManager } = require('../../../../utils/configManager');
const { SecurityTagSystem } = require('../../../../utils/securityTagSystem');

function createMockInstance(ClassType) {
    return Object.create(ClassType.prototype);
}

describe('Merge Cross-Tenant Write Vulnerability', () => {
    let scopesValidator;
    let scopesManager;
    let patientFilterManager;

    beforeEach(() => {
        patientFilterManager = new PatientFilterManager();

        scopesManager = new ScopesManager({
            configManager: createMockInstance(ConfigManager),
            patientFilterManager
        });

        const mockPatientScopeManager = createMockInstance(PatientScopeManager);
        // Simulate canWriteResourceAsync: for patient-filterable resources with matching
        // patient reference, it returns true
        mockPatientScopeManager.canWriteResourceAsync = jestGlobal.fn().mockResolvedValue(true);

        const mockPreSaveManager = createMockInstance(PreSaveManager);
        mockPreSaveManager.preSaveAsync = jestGlobal.fn().mockImplementation(
            ({ resource }) => Promise.resolve(resource)
        );

        const mockFhirLoggingManager = createMockInstance(FhirLoggingManager);
        mockFhirLoggingManager.logOperationFailureAsync = jestGlobal.fn().mockResolvedValue(undefined);

        const mockConfigManager = createMockInstance(ConfigManager);
        Object.defineProperty(mockConfigManager, 'enableDelegatedAccessDetection', {
            get: () => false, configurable: true
        });

        const mockDelegatedAccessScopeManager = createMockInstance(DelegatedAccessScopeManager);
        mockDelegatedAccessScopeManager.isAccessAllowedAsync = jestGlobal.fn().mockResolvedValue(true);

        scopesValidator = new ScopesValidator({
            scopesManager,
            fhirLoggingManager: mockFhirLoggingManager,
            configManager: mockConfigManager,
            patientScopeManager: mockPatientScopeManager,
            preSaveManager: mockPreSaveManager,
            delegatedAccessScopeManager: mockDelegatedAccessScopeManager
        });
    });

    describe('isAccessToResourceAllowedByAccessAndPatientScopes on new merge resources', () => {
        test('MUST deny creating Observation with owner=other_tenant when user has access/my_tenant', async () => {
            const requestInfo = {
                user: 'attacker@my_tenant',
                scope: 'patient/Observation.write access/my_tenant.*',
                isUser: true,
                personIdFromJwtToken: 'person-attacker'
            };

            const maliciousResource = {
                resourceType: 'Observation',
                id: 'injected-obs',
                _uuid: 'uuid-injected-obs',
                subject: { reference: 'Patient/patient-in-both-tenants' },
                meta: {
                    security: [
                        { system: SecurityTagSystem.owner, code: 'other_tenant' },
                        { system: SecurityTagSystem.access, code: 'other_tenant' }
                    ]
                }
            };

            // CORRECT: Should throw ForbiddenError because the resource's owner/access
            // tags don't match the user's access scope (my_tenant vs other_tenant).
            // CURRENT BUG: Does NOT throw because isAccessToResourceAllowedBySecurityTags
            // returns true when patient scope is present for patient-filterable resources.
            await expect(
                scopesValidator.isAccessToResourceAllowedByAccessAndPatientScopes({
                    requestInfo,
                    resource: maliciousResource,
                    base_version: '4_0_0'
                })
            ).rejects.toThrow();
        });

        test('MUST deny creating Condition with owner=competitor when user has access/my_health', async () => {
            const requestInfo = {
                user: 'user@my_health',
                scope: 'patient/Condition.write access/my_health.*',
                isUser: true,
                personIdFromJwtToken: 'person-user'
            };

            const maliciousResource = {
                resourceType: 'Condition',
                id: 'injected-cond',
                _uuid: 'uuid-injected-cond',
                subject: { reference: 'Patient/some-patient' },
                meta: {
                    security: [
                        { system: SecurityTagSystem.owner, code: 'competitor' },
                        { system: SecurityTagSystem.access, code: 'competitor' }
                    ]
                }
            };

            await expect(
                scopesValidator.isAccessToResourceAllowedByAccessAndPatientScopes({
                    requestInfo,
                    resource: maliciousResource,
                    base_version: '4_0_0'
                })
            ).rejects.toThrow();
        });

        test('MUST deny creating non-patient-filterable resource (Organization) with patient scope', async () => {
            const requestInfo = {
                user: 'attacker@tenant_a',
                scope: 'patient/Organization.write access/tenant_a.*',
                isUser: true,
                personIdFromJwtToken: 'person-attacker'
            };

            const maliciousResource = {
                resourceType: 'Organization',
                id: 'fake-org',
                _uuid: 'uuid-fake-org',
                meta: {
                    security: [
                        { system: SecurityTagSystem.owner, code: 'tenant_b' },
                        { system: SecurityTagSystem.access, code: 'tenant_b' }
                    ]
                }
            };

            // CORRECT: Should throw because:
            // 1. Organization is not patient-filterable, so patient scope should NOT grant write
            // 2. Even if somehow allowed, owner=tenant_b does not match user's access/tenant_a
            await expect(
                scopesValidator.isAccessToResourceAllowedByAccessAndPatientScopes({
                    requestInfo,
                    resource: maliciousResource,
                    base_version: '4_0_0'
                })
            ).rejects.toThrow();
        });
    });

    describe('Merge with existing cross-tenant resource', () => {
        test('MUST deny updating existing Observation owned by other_tenant via merge', async () => {
            const requestInfo = {
                user: 'attacker@tenant_a',
                scope: 'patient/Observation.write access/tenant_a.*',
                isUser: true,
                personIdFromJwtToken: 'person-attacker'
            };

            // This simulates the foundResource from the database — owned by other_tenant
            const existingResource = {
                resourceType: 'Observation',
                id: 'existing-obs',
                _uuid: 'uuid-existing-obs',
                subject: { reference: 'Patient/patient-in-both-tenants' },
                meta: {
                    security: [
                        { system: SecurityTagSystem.owner, code: 'other_tenant' },
                        { system: SecurityTagSystem.access, code: 'other_tenant' }
                    ]
                }
            };

            // The writeAllowedByScopesValidator calls this on the foundResource for updates
            await expect(
                scopesValidator.isAccessToResourceAllowedByAccessAndPatientScopes({
                    requestInfo,
                    resource: existingResource,
                    base_version: '4_0_0'
                })
            ).rejects.toThrow();
        });
    });
});
