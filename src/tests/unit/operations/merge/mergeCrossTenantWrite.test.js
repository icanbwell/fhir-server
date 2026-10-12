/**
 * Tests for merge write authorization with patient-scoped tokens.
 *
 * By design (docs/resource-authorization.md section 5) a patient/ scope on a patient-filterable
 * resource type is NOT decided by access tags: ScopesManager.isAccessToResourceAllowedBySecurityTags
 * returns true and the real guard is PatientScopeManager.canWriteResourceAsync, which only lets the
 * caller write resources reachable through its own Person/Patient identity graph. A patient scope
 * must never authorize writes to non-patient-filterable types (Organization, Practitioner, ...);
 * those fall through to the access-tag check.
 *
 * These tests use the real ScopesManager and PatientScopeManager (only the Person->Patient id
 * expansion, which needs a database, is stubbed) so the denial is decided by production code.
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

describe('Merge write authorization with patient-scoped tokens', () => {
    let scopesValidator;
    let scopesManager;
    let patientFilterManager;

    beforeEach(() => {
        patientFilterManager = new PatientFilterManager();

        scopesManager = new ScopesManager({
            configManager: createMockInstance(ConfigManager),
            patientFilterManager
        });

        // Real PatientScopeManager; the caller's own Person resolves to this single Patient
        const patientScopeManager = createMockInstance(PatientScopeManager);
        patientScopeManager.scopesManager = scopesManager;
        patientScopeManager.patientFilterManager = patientFilterManager;
        patientScopeManager.getPatientIdsFromScopeAsync = jestGlobal.fn().mockResolvedValue(['my-patient']);

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
            patientScopeManager,
            preSaveManager: mockPreSaveManager,
            delegatedAccessScopeManager: mockDelegatedAccessScopeManager
        });
    });

    describe('isAccessToResourceAllowedByAccessAndPatientScopes on new merge resources', () => {
        test('MUST deny creating Observation for a Patient outside the caller\'s own identity graph', async () => {
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
                subject: { reference: 'Patient/someone-elses-patient' },
                meta: {
                    security: [
                        { system: SecurityTagSystem.owner, code: 'other_tenant' },
                        { system: SecurityTagSystem.access, code: 'other_tenant' }
                    ]
                }
            };

            // The tag check is skipped for patient-filterable types under a patient scope; the
            // write is denied because the subject Patient is not one of the caller's own patients.
            await expect(
                scopesValidator.isAccessToResourceAllowedByAccessAndPatientScopes({
                    requestInfo,
                    resource: maliciousResource,
                    base_version: '4_0_0'
                })
            ).rejects.toThrow(
                'The current patient scope and person id in the JWT token do not allow writing the Observation resource.'
            );
        });

        test('MUST deny creating Condition for a Patient outside the caller\'s own identity graph', async () => {
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
                subject: { reference: 'Patient/someone-elses-patient' },
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
            ).rejects.toThrow(
                'The current patient scope and person id in the JWT token do not allow writing the Condition resource.'
            );
        });

        test('MUST deny creating non-patient-filterable resource (Organization) with patient scope even when tags match', async () => {
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
                        { system: SecurityTagSystem.owner, code: 'tenant_a' },
                        { system: SecurityTagSystem.access, code: 'tenant_a' }
                    ]
                }
            };

            // The tags match the caller's access/tenant_a, so the access-tag check passes; the write
            // is denied only because a patient scope never authorizes non-patient-filterable types.
            await expect(
                scopesValidator.isAccessToResourceAllowedByAccessAndPatientScopes({
                    requestInfo,
                    resource: maliciousResource,
                    base_version: '4_0_0'
                })
            ).rejects.toThrow(
                'The current patient scope and person id in the JWT token do not allow writing the Organization resource.'
            );
        });
    });

    describe('Merge with existing cross-tenant resource', () => {
        test('MUST deny updating an existing Observation of a Patient outside the caller\'s own identity graph', async () => {
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
                subject: { reference: 'Patient/someone-elses-patient' },
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
            ).rejects.toThrow(
                'The current patient scope and person id in the JWT token do not allow writing the Observation resource.'
            );
        });
    });
});
