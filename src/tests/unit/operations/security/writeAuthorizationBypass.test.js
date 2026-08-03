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
    // VULNERABILITY 1: isAccessToResourceAllowedBySecurityTags skips security
    // tag check for patient-filterable resources when patient scope is present
    // =========================================================================
    describe('VULN-1: Security tag bypass on writes via patient scope', () => {
        let scopesManager;

        beforeEach(() => {
            const mockConfigManager = { authEnabled: true };
            const mockPatientFilterManager = new PatientFilterManager();
            scopesManager = new ScopesManager({
                configManager: mockConfigManager,
                patientFilterManager: mockPatientFilterManager
            });
        });

        test('patient-scoped user must NOT write Observation owned by another tenant', () => {
            // A user with patient/Observation.write scope tries to access an Observation
            // that belongs to 'evil_corp' tenant. The user's access is 'alpha_health'.
            const scope = 'patient/Observation.write access/alpha_health.*';
            const resource = {
                resourceType: 'Observation',
                meta: {
                    security: [
                        { system: SecurityTagSystem.owner, code: 'evil_corp' },
                        { system: SecurityTagSystem.access, code: 'evil_corp' }
                    ]
                }
            };

            // CURRENT BUG: isAccessToResourceAllowedBySecurityTags returns TRUE
            // at line 133 of scopesManager.js because isAccessAllowedByPatientScopes
            // returns true for Observation, and then it immediately returns true
            // without checking the owner/access tags.
            //
            // CORRECT BEHAVIOR: must return false because resource belongs to 'evil_corp'
            // and user only has access to 'alpha_health'
            const result = scopesManager.isAccessToResourceAllowedBySecurityTags({
                resource,
                user: 'user@alpha_health',
                scope,
                accessRequested: 'write'
            });

            expect(result).toBe(false);
        });

        test('patient-scoped user must NOT write Condition from different tenant', () => {
            const scope = 'patient/Condition.write access/tenant_a.*';
            const resource = {
                resourceType: 'Condition',
                meta: {
                    security: [
                        { system: SecurityTagSystem.owner, code: 'tenant_b' },
                        { system: SecurityTagSystem.access, code: 'tenant_b' }
                    ]
                }
            };

            const result = scopesManager.isAccessToResourceAllowedBySecurityTags({
                resource,
                user: 'user@tenant_a',
                scope,
                accessRequested: 'write'
            });

            // CORRECT: must deny access to cross-tenant resource
            expect(result).toBe(false);
        });

        test('patient-scoped user must NOT delete Patient from different tenant', () => {
            const scope = 'patient/Patient.write access/my_health.*';
            const resource = {
                resourceType: 'Patient',
                meta: {
                    security: [
                        { system: SecurityTagSystem.owner, code: 'other_health' },
                        { system: SecurityTagSystem.access, code: 'other_health' }
                    ]
                }
            };

            const result = scopesManager.isAccessToResourceAllowedBySecurityTags({
                resource,
                user: 'user@my_health',
                scope,
                accessRequested: 'write'
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
    // The patchInternalFieldsValidator only blocks fields starting with '_',
    // but meta.security does NOT start with '_' so it passes through unchecked.
    // =========================================================================
    describe('VULN-3: PATCH can modify meta.security tags for privilege escalation', () => {
        // We test the validator directly — it should reject paths targeting meta/security
        const { validatePatchDoesNotTargetInternalFields } = require(
            '../../../../operations/patch/validators/patchInternalFieldsValidator'
        );

        test('PATCH replacing meta/security owner tag must be rejected', () => {
            const patchContent = [
                {
                    op: 'replace',
                    path: '/meta/security/0/code',
                    value: 'attacker_tenant'
                }
            ];

            // CURRENT BUG: This passes validation because '/meta/security/0/code'
            // has no segment starting with '_'.
            // CORRECT: Should throw BadRequestError because modifying security tags
            // allows privilege escalation (changing resource ownership/access).
            expect(() => {
                validatePatchDoesNotTargetInternalFields(patchContent);
            }).toThrow();
        });

        test('PATCH adding new security tag must be rejected', () => {
            const patchContent = [
                {
                    op: 'add',
                    path: '/meta/security/-',
                    value: {
                        system: 'https://www.icanbwell.com/access',
                        code: 'attacker_tenant'
                    }
                }
            ];

            // CORRECT: Should throw because adding access tags = giving self access
            expect(() => {
                validatePatchDoesNotTargetInternalFields(patchContent);
            }).toThrow();
        });

        test('PATCH removing owner security tag must be rejected', () => {
            const patchContent = [
                {
                    op: 'remove',
                    path: '/meta/security/0'
                }
            ];

            // CORRECT: Should throw because removing security tags = removing access control
            expect(() => {
                validatePatchDoesNotTargetInternalFields(patchContent);
            }).toThrow();
        });

        test('PATCH replacing entire meta.security array must be rejected', () => {
            const patchContent = [
                {
                    op: 'replace',
                    path: '/meta/security',
                    value: [
                        { system: 'https://www.icanbwell.com/owner', code: 'attacker' },
                        { system: 'https://www.icanbwell.com/access', code: 'attacker' }
                    ]
                }
            ];

            // CORRECT: Should throw because rewriting security = taking ownership
            expect(() => {
                validatePatchDoesNotTargetInternalFields(patchContent);
            }).toThrow();
        });

        test('PATCH replacing meta.source must be rejected', () => {
            const patchContent = [
                {
                    op: 'replace',
                    path: '/meta/source',
                    value: 'https://attacker.com/data'
                }
            ];

            // CORRECT: meta.source is used for provenance tracking and should be immutable
            expect(() => {
                validatePatchDoesNotTargetInternalFields(patchContent);
            }).toThrow();
        });
    });

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

        test('user with access/tenant_a should NOT be allowed to create resource with owner=tenant_b', () => {
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
    // VULNERABILITY 5: Patient-scoped write to resources owned by different tenant
    // The write flow (create/update) calls isAccessToResourceAllowedByAccessAndPatientScopes
    // which calls both:
    //   1. isAccessToResourceAllowedByAccessScopes — bypassed for patient-filterable (VULN-1)
    //   2. isAccessToResourceAllowedByPatientScopes — only checks patient reference, not tenant
    // So combining both, a patient-scoped user can write ANY patient-filterable resource
    // regardless of which tenant owns it, as long as the patient reference matches.
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

        test('should DENY write when patient reference matches but tenant does NOT match', () => {
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

        test('should DENY delete when patient reference matches but tenant does NOT match', () => {
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
