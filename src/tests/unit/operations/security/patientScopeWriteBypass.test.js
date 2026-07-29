/**
 * Tests for PatientScopeManager.canWriteResourceAsync authorization bypass.
 *
 * VULNERABILITY: canWriteResourceAsync at line 286-290 of patientScopeManager.js:
 *
 *   if (!this.scopesManager.isAccessAllowedByPatientScopes({
 *       scope, resourceType: resource.resourceType
 *   })) {
 *       return true;  // <-- BUG: unconditional allow for non-patient-filterable types
 *   }
 *
 * When a resource type is NOT in the patientFilterMapping (e.g., Organization,
 * Practitioner, Location, ValueSet, CodeSystem, etc.), the method returns true
 * immediately, meaning ANY patient-scoped user can write ANY non-patient-filterable
 * resource regardless of tenant ownership.
 *
 * This is catastrophic because:
 * - Reference data (Practitioner, Organization, Location) is shared across patients
 * - Terminology resources (ValueSet, CodeSystem) affect clinical decision support
 * - StructureDefinition controls validation rules
 *
 * Exploitation scenario:
 * 1. Attacker obtains any patient-scoped token (even expired consent is enough for scope)
 * 2. Attacker sends PUT/POST to Organization, Practitioner, Location, etc.
 * 3. canWriteResourceAsync returns true because resourceType is not patient-filterable
 * 4. The access scope check in isAccessToResourceAllowedByAccessScopes may or may not
 *    block this (depends on whether user scopes also contain access/ scopes that match)
 * 5. If attacker's token has access/* (wildcard), they can write to ALL shared resources
 *
 * Severity: HIGH — allows modification of shared reference data affecting all patients
 */
const { describe, test, expect, beforeEach, jest: jestGlobal } = require('@jest/globals');

jestGlobal.mock('../../../../utils/assertType', () => ({
    assertIsValid: (val, msg) => { if (!val) throw new Error(msg || 'assertion failed'); },
    assertTypeEquals: () => {}
}));

const { PatientScopeManager } = require('../../../../operations/security/patientScopeManager');
const { PatientFilterManager } = require('../../../../fhir/patientFilterManager');
const { SecurityTagSystem } = require('../../../../utils/securityTagSystem');

describe('PatientScopeManager.canWriteResourceAsync — Non-Patient-Filterable Bypass', () => {
    let patientScopeManager;
    let mockScopesManager;
    let patientFilterManager;

    beforeEach(() => {
        patientFilterManager = new PatientFilterManager();

        mockScopesManager = {
            isAccessAllowedByPatientScopes: jestGlobal.fn().mockImplementation(
                ({ scope, resourceType }) => {
                    // Use real PatientFilterManager logic
                    return patientFilterManager.canAccessResourceWithPatientScope({ resourceType }) &&
                        scope.includes('patient/');
                }
            )
        };

        patientScopeManager = new PatientScopeManager({
            databaseQueryFactory: { createQuery: jestGlobal.fn() },
            personToPatientIdsExpander: { getPatientIdsFromPersonAsync: jestGlobal.fn().mockResolvedValue([]) },
            scopesManager: mockScopesManager,
            patientFilterManager
        });
    });

    // Non-patient-filterable resource types that should NEVER be writable via patient scope
    const nonPatientFilterableTypes = [
        'Organization',
        'Practitioner',
        'PractitionerRole',
        'Location',
        'HealthcareService',
        'ValueSet',
        'CodeSystem',
        'StructureDefinition',
        'CapabilityStatement',
        'OperationDefinition',
        'SearchParameter',
        'NamingSystem',
        'ConceptMap',
        'Endpoint',
        'InsurancePlan',
        'Medication'
    ];

    for (const resourceType of nonPatientFilterableTypes) {
        test(`patient-scoped user must NOT write ${resourceType} resources`, async () => {
            const resource = {
                resourceType,
                _uuid: `uuid-test-${resourceType.toLowerCase()}`,
                id: `${resourceType.toLowerCase()}-1`,
                meta: {
                    security: [
                        { system: SecurityTagSystem.owner, code: 'some_tenant' },
                        { system: SecurityTagSystem.access, code: 'some_tenant' }
                    ]
                }
            };

            // CURRENT BUG: Returns true because isAccessAllowedByPatientScopes returns false
            // for non-patient-filterable types, triggering the immediate `return true` at line 290.
            //
            // CORRECT BEHAVIOR: Should either:
            // a) Return false (denying the write), or
            // b) Throw ForbiddenError (as canWriteResourceWithAllowedPatientIdsAsync does)
            //
            // Patient scope should NEVER grant write access to shared/admin resources.
            const result = await patientScopeManager.canWriteResourceAsync({
                base_version: '4_0_0',
                isUser: true,
                personIdFromJwtToken: 'person-patient-user',
                resource,
                scope: `patient/${resourceType}.write access/tenant_a.*`
            });

            expect(result).toBe(false);
        });
    }

    test('patient-scoped user CAN still write Patient (patient-filterable)', async () => {
        // Ensure we don't break legitimate writes. Patient is patient-filterable.
        // The test should pass because Patient IS in patientFilterMapping.
        // Note: This test validates canWriteResourceAsync proceeds to the
        // patient ID check (which requires linked patient IDs to match).
        const resource = {
            resourceType: 'Patient',
            _uuid: 'uuid-patient-mine',
            id: 'patient-mine',
            meta: {
                security: [
                    { system: SecurityTagSystem.owner, code: 'my_tenant' },
                    { system: SecurityTagSystem.access, code: 'my_tenant' }
                ]
            }
        };

        // For patient-filterable resources, canWriteResourceAsync should NOT return true
        // immediately — it should proceed to check patient IDs.
        // Since we mocked getPatientIdsFromPersonAsync to return [], this will return false
        // (no patient IDs linked to the person), which is correct behavior.
        const result = await patientScopeManager.canWriteResourceAsync({
            base_version: '4_0_0',
            isUser: true,
            personIdFromJwtToken: 'person-patient-user',
            resource,
            scope: 'patient/Patient.write access/my_tenant.*'
        });

        // This should be false because no linked patients were found
        // (getPatientIdsFromPersonAsync returns [])
        expect(result).toBe(false);
    });
});
