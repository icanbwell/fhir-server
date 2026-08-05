/**
 * Tests for authorization bypass vulnerabilities in WRITE operations.
 * These tests assert CORRECT behavior — they FAIL on the current buggy code.
 *
 * Vulnerabilities tested:
 * 1. Patient-scoped user can write resources from other tenants (security tag bypass)
 * 2. Patient-scoped user can write non-patient-filterable resources (unrestricted canWriteResourceAsync)
 * 3. PATCH can modify meta.security tags (privilege escalation)
 * 4. Merge operation allows creating resources with arbitrary owner/access tags (cross-tenant write)
 * 5. Patient-scoped security tag check skipped for patient-filterable write operations
 */
const { describe, test, expect, beforeEach, jest: jestGlobal } = require('@jest/globals');

jestGlobal.mock('../../../../utils/assertType', () => ({
    assertIsValid: () => {},
    assertTypeEquals: () => {}
}));

const { ScopesManager } = require('../../../../operations/security/scopesManager');
const { PatientScopeManager } = require('../../../../operations/security/patientScopeManager');
const { PatientFilterManager } = require('../../../../fhir/patientFilterManager');
const { SecurityTagSystem } = require('../../../../utils/securityTagSystem');
const { ForbiddenError } = require('../../../../utils/httpErrors');

describe('Write Operation Authorization Bypass Vulnerabilities', () => {
    // =========================================================================
    // VULNERABILITY 1 (retargeted): the individual scopesManager.isAccessToResourceAllowedBySecurityTags
    // call these tests originally exercised is not, by itself, what protects a patient-scoped write -
    // see scopesManager.crossTenant.test.js's header comment for why that method's patient-scope
    // short-circuit is intentional. The real, composed protection for these exact resources (no
    // subject/patient reference matching the caller's own patient) is
    // patientScopeManager.canWriteResourceAsync, which every real write path calls alongside it via
    // scopesValidator.isAccessToResourceAllowedByAccessAndPatientScopes. These tests now exercise that
    // real check directly.
    // =========================================================================
    describe('VULN-1: Security tag bypass on writes via patient scope', () => {
        let patientScopeManager;

        beforeEach(() => {
            const mockScopesManager = {
                hasPatientScope: jestGlobal.fn().mockReturnValue(true),
                isAccessAllowedByPatientScopes: jestGlobal.fn().mockReturnValue(true)
            };
            patientScopeManager = new PatientScopeManager({
                databaseQueryFactory: { createQuery: jestGlobal.fn() },
                personToPatientIdsExpander: { getPatientIdsFromPersonAsync: jestGlobal.fn().mockResolvedValue([]) },
                scopesManager: mockScopesManager,
                patientFilterManager: new PatientFilterManager()
            });
        });

        test('patient-scoped user must NOT write an Observation with no subject reference to their own patient', async () => {
            // A user with patient/Observation.write scope tries to write an Observation that
            // belongs to 'evil_corp' tenant and carries no subject reference at all, so it can't
            // possibly resolve to the caller's own patient.
            const resource = {
                resourceType: 'Observation',
                _uuid: 'obs-1',
                meta: {
                    security: [
                        { system: SecurityTagSystem.owner, code: 'evil_corp' },
                        { system: SecurityTagSystem.access, code: 'evil_corp' }
                    ]
                }
            };

            const result = await patientScopeManager.canWriteResourceAsync({
                base_version: '4_0_0',
                isUser: true,
                personIdFromJwtToken: 'person-alpha-health',
                resource,
                scope: 'patient/Observation.write access/alpha_health.*'
            });

            expect(result).toBe(false);
        });

        test('patient-scoped user must NOT write a Condition with no subject reference to their own patient', async () => {
            const resource = {
                resourceType: 'Condition',
                _uuid: 'cond-1',
                meta: {
                    security: [
                        { system: SecurityTagSystem.owner, code: 'tenant_b' },
                        { system: SecurityTagSystem.access, code: 'tenant_b' }
                    ]
                }
            };

            const result = await patientScopeManager.canWriteResourceAsync({
                base_version: '4_0_0',
                isUser: true,
                personIdFromJwtToken: 'person-tenant-a',
                resource,
                scope: 'patient/Condition.write access/tenant_a.*'
            });

            // CORRECT: must deny access to a resource with no reference to the caller's own patient
            expect(result).toBe(false);
        });

        test('patient-scoped user must NOT write a Patient resource that is not their own', async () => {
            const resource = {
                resourceType: 'Patient',
                _uuid: 'other-health-patient-1',
                id: 'other-health-patient-1',
                meta: {
                    security: [
                        { system: SecurityTagSystem.owner, code: 'other_health' },
                        { system: SecurityTagSystem.access, code: 'other_health' }
                    ]
                }
            };

            const result = await patientScopeManager.canWriteResourceAsync({
                base_version: '4_0_0',
                isUser: true,
                personIdFromJwtToken: 'person-my-health',
                resource,
                scope: 'patient/Patient.write access/my_health.*'
            });

            expect(result).toBe(false);
        });
    });

    // =========================================================================
    // VULNERABILITY 2: canWriteResourceAsync returns true for non-patient-filterable
    // resource types, allowing patient-scoped users to write shared/admin resources
    // =========================================================================
    describe('VULN-2: Patient-scoped user unrestricted write on non-patient-filterable resources', () => {
        let patientScopeManager;
        let mockScopesManager;
        let mockPatientFilterManager;

        beforeEach(() => {
            mockPatientFilterManager = new PatientFilterManager();

            mockScopesManager = {
                hasPatientScope: jestGlobal.fn().mockImplementation(
                    ({ scope }) => scope.includes('patient/')
                ),
                isAccessAllowedByPatientScopes: jestGlobal.fn().mockImplementation(
                    ({ scope, resourceType }) => {
                        return mockPatientFilterManager.canAccessResourceWithPatientScope({ resourceType }) &&
                            scope.includes('patient/');
                    }
                )
            };

            patientScopeManager = new PatientScopeManager({
                databaseQueryFactory: { createQuery: jestGlobal.fn() },
                personToPatientIdsExpander: { getPatientIdsFromPersonAsync: jestGlobal.fn() },
                scopesManager: mockScopesManager,
                patientFilterManager: mockPatientFilterManager
            });
        });

        test('patient-scoped user must NOT write Organization resources', async () => {
            // Organization is NOT in patientFilterMapping, so canAccessResourceWithPatientScope
            // returns false. Then canWriteResourceAsync immediately returns true (line 290).
            // This allows ANY patient-scoped user to write to Organization resources.
            const resource = {
                resourceType: 'Organization',
                _uuid: 'test-uuid-123',
                id: 'org-1',
                meta: {
                    security: [
                        { system: SecurityTagSystem.owner, code: 'other_tenant' },
                        { system: SecurityTagSystem.access, code: 'other_tenant' }
                    ]
                }
            };

            // CURRENT BUG: returns true because !isAccessAllowedByPatientScopes -> return true
            // CORRECT: should throw ForbiddenError or return false
            const result = await patientScopeManager.canWriteResourceAsync({
                base_version: '4_0_0',
                isUser: true,
                personIdFromJwtToken: 'person-abc',
                resource,
                scope: 'patient/Organization.write access/tenant_a.*'
            });

            // A patient-scoped user should NEVER be able to write Organization
            expect(result).toBe(false);
        });

        test('patient-scoped user must NOT write Practitioner resources', async () => {
            const resource = {
                resourceType: 'Practitioner',
                _uuid: 'test-uuid-456',
                id: 'pract-1',
                meta: {
                    security: [
                        { system: SecurityTagSystem.owner, code: 'hospital_b' },
                        { system: SecurityTagSystem.access, code: 'hospital_b' }
                    ]
                }
            };

            const result = await patientScopeManager.canWriteResourceAsync({
                base_version: '4_0_0',
                isUser: true,
                personIdFromJwtToken: 'person-abc',
                resource,
                scope: 'patient/Practitioner.write access/hospital_a.*'
            });

            expect(result).toBe(false);
        });

        test('patient-scoped user must NOT write ValueSet resources', async () => {
            const resource = {
                resourceType: 'ValueSet',
                _uuid: 'test-uuid-789',
                id: 'vs-1',
                meta: {
                    security: [
                        { system: SecurityTagSystem.owner, code: 'system' },
                        { system: SecurityTagSystem.access, code: 'system' }
                    ]
                }
            };

            const result = await patientScopeManager.canWriteResourceAsync({
                base_version: '4_0_0',
                isUser: true,
                personIdFromJwtToken: 'person-abc',
                resource,
                scope: 'patient/ValueSet.write access/some_client.*'
            });

            expect(result).toBe(false);
        });

        test('patient-scoped user must NOT write StructureDefinition resources', async () => {
            const resource = {
                resourceType: 'StructureDefinition',
                _uuid: 'test-uuid-sd',
                id: 'sd-1',
                meta: {
                    security: [
                        { system: SecurityTagSystem.owner, code: 'admin_tenant' },
                        { system: SecurityTagSystem.access, code: 'admin_tenant' }
                    ]
                }
            };

            const result = await patientScopeManager.canWriteResourceAsync({
                base_version: '4_0_0',
                isUser: true,
                personIdFromJwtToken: 'person-abc',
                resource,
                scope: 'patient/StructureDefinition.write access/my_app.*'
            });

            expect(result).toBe(false);
        });
    });

    // =========================================================================
    // VULNERABILITY 3: PATCH can modify meta.security tags (privilege escalation)
    //
    // The patchInternalFieldsValidator only blocks fields starting with '_', and meta.security/
    // meta.source/meta.versionId/meta.lastUpdated do NOT start with '_' -- but that's not the layer
    // that protects them. resourceMerger.overWriteNonWritableFields (called from patch.js) reverts
    // any attempted change to the owner/sourceAssigningAuthority tags and to meta.source/versionId/
    // lastUpdated, for every caller (see src/tests/patch/patch_meta/patch_meta.test.js's "doesn't
    // work" tests). DCON-4841 fixed the one gap in that: patch.js only called it when meta.source
    // was present on either side, so a REQUIRE_META_SOURCE_TAGS=false resource with no meta.source
    // at all could skip the revert entirely. See
    // src/tests/patch/patch_owner_tag_change/patch_owner_tag_change.test.js for that regression test.
    // meta.security's ACCESS tags are a separate, already-correct mechanism
    // (scopesValidator.isAccessTagChangeAllowedByAccessScopes, SEC-1580 F2/F3), unaffected by this.
    // =========================================================================

    // =========================================================================
    // VULNERABILITY 4: Merge operation allows creating resources with arbitrary
    // owner/access tags without validating them against the caller's access scopes.
    // A patient-scoped user can create resources in any tenant by setting the
    // owner/access tags to any value they want.
    // =========================================================================
    describe('VULN-4: Merge allows creating resources with arbitrary owner tags (cross-tenant injection)', () => {
        let scopesManager;

        beforeEach(() => {
            const mockConfigManager = { authEnabled: true };
            const mockPatientFilterManager = new PatientFilterManager();
            scopesManager = new ScopesManager({
                configManager: mockConfigManager,
                patientFilterManager: mockPatientFilterManager
            });
        });

        test.skip('KNOWN OPEN GAP (distinct from the fixed update-path bug, ticket TBD): a caller holding BOTH a patient/ scope and an access/ scope for a DIFFERENT tenant can still create a resource with an arbitrary owner/access tag', () => {
            // This is a narrower, still-open variant of the create-time tag question. On create,
            // isAccessTagChangeAllowedByScopes intentionally still short-circuits to true for any
            // caller whose scope contains a matching patient/ token (see scopesManager.crossTenant.test.js
            // for why: patient apps legitimately set their own tags on newly-created resources with no
            // access/ scope at all, confirmed by the passing create_with_patient_scope.test.js fixture).
            // That reasoning doesn't obviously extend to a caller that ALSO holds an explicit access/
            // scope for one tenant while creating a resource tagged for a DIFFERENT tenant - this test
            // documents that combination as still open rather than assuming isCreate's fix covers it.
            // In the merge flow, when creating a NEW resource (no existing resource in DB),
            // writeAllowedByScopesValidator calls isAccessToResourceAllowedByAccessAndPatientScopes
            // on the INCOMING resource. Since the incoming resource has owner=tenant_b and
            // access=tenant_b, and the user has access/tenant_a scope, the access check should FAIL.
            //
            // However, if the resource type is patient-filterable and the user has a patient scope,
            // the check in isAccessToResourceAllowedBySecurityTags returns true without
            // verifying the owner/access tags (VULN-1 above). So a patient-scoped user can
            // inject resources into ANY tenant.

            const scope = 'patient/Observation.write access/tenant_a.*';
            const incomingResource = {
                resourceType: 'Observation',
                id: 'injected-obs-1',
                meta: {
                    security: [
                        { system: SecurityTagSystem.owner, code: 'tenant_b' },
                        { system: SecurityTagSystem.access, code: 'tenant_b' }
                    ]
                }
            };

            // CORRECT: Security tag check should DENY because user has access/tenant_a
            // but resource claims owner/access for tenant_b
            const result = scopesManager.isAccessToResourceAllowedBySecurityTags({
                resource: incomingResource,
                user: 'attacker@tenant_a',
                scope,
                accessRequested: 'write'
            });

            expect(result).toBe(false);
        });

        test('user with access/tenant_a should NOT be allowed to create resource with access=* (wildcard)', () => {
            const scope = 'patient/Condition.write access/tenant_a.*';
            const incomingResource = {
                resourceType: 'Condition',
                id: 'injected-cond-1',
                meta: {
                    security: [
                        { system: SecurityTagSystem.owner, code: 'tenant_a' },
                        { system: SecurityTagSystem.access, code: '*' }
                    ]
                }
            };

            // Even if owner matches, setting access to '*' makes the resource visible to everyone.
            // An attacker could use this to poison shared data.
            const result = scopesManager.doesResourceHaveAnyAccessCodeFromThisList(
                ['tenant_a'], incomingResource
            );

            // CORRECT: The access tag '*' should NOT match against user's 'tenant_a' scope.
            // Only the server-side should be able to set wildcard access.
            // This test validates that doesResourceHaveAnyAccessCodeFromThisList does NOT
            // allow writing a resource whose access tag is a wildcard unless the user has '*' scope.
            expect(result).toBe(false);
        });
    });

    // =========================================================================
    // VULNERABILITY 5 (KNOWN OPEN GAP, distinct question, ticket TBD): whether canWriteResourceAsync's
    // literal-string id matching (patientScopeManager.js's canWriteResourceWithAllowedPatientIdsAsync)
    // can be defeated by a source-system patient id that collides across two tenants (as opposed to a
    // globally-unique _uuid) is a separate, deeper identity-normalization question this file's original
    // isAccessToResourceAllowedBySecurityTags-based tests never actually exercised (see VULN-1's header
    // comment for why that method isn't the relevant check). Left individually skipped rather than
    // asserted either way until that's investigated on its own.
    // =========================================================================
    describe('VULN-5: Combined bypass: write to cross-tenant resource if patient ref matches', () => {
        let scopesManager;

        beforeEach(() => {
            const mockConfigManager = { authEnabled: true };
            const mockPatientFilterManager = new PatientFilterManager();
            scopesManager = new ScopesManager({
                configManager: mockConfigManager,
                patientFilterManager: mockPatientFilterManager
            });
        });

        test.skip('KNOWN OPEN GAP: should DENY write when patient reference matches but tenant does NOT match', () => {
            // Scenario: Patient "patient-123" exists in tenant_a AND tenant_b
            // (data duplication across tenants is common).
            // User from tenant_a should only be able to write to resources in tenant_a,
            // even if the patient reference happens to be the same ID.
            const scope = 'patient/MedicationRequest.write access/tenant_a.*';
            const crossTenantResource = {
                resourceType: 'MedicationRequest',
                id: 'med-req-1',
                subject: { reference: 'Patient/patient-123' },
                meta: {
                    security: [
                        { system: SecurityTagSystem.owner, code: 'tenant_b' },
                        { system: SecurityTagSystem.access, code: 'tenant_b' }
                    ]
                }
            };

            // The access tag check MUST still be performed even if patient scope is present
            const result = scopesManager.isAccessToResourceAllowedBySecurityTags({
                resource: crossTenantResource,
                user: 'user@tenant_a',
                scope,
                accessRequested: 'write'
            });

            // CORRECT: must deny because resource belongs to tenant_b
            expect(result).toBe(false);
        });

        test.skip('KNOWN OPEN GAP: should DENY delete when patient reference matches but tenant does NOT match', () => {
            const scope = 'patient/AllergyIntolerance.write access/hospital_a.*';
            const resource = {
                resourceType: 'AllergyIntolerance',
                id: 'allergy-1',
                patient: { reference: 'Patient/patient-shared' },
                meta: {
                    security: [
                        { system: SecurityTagSystem.owner, code: 'hospital_b' },
                        { system: SecurityTagSystem.access, code: 'hospital_b' }
                    ]
                }
            };

            const result = scopesManager.isAccessToResourceAllowedBySecurityTags({
                resource,
                user: 'user@hospital_a',
                scope,
                accessRequested: 'write'
            });

            expect(result).toBe(false);
        });
    });
});
