/**
 * Tests for cross-tenant security vulnerabilities in merge and patch operations.
 *
 * VULNERABILITY 1 — Cross-Tenant Person/Patient Merge via Link Injection:
 * When a Person resource is merged with a `link` field pointing to a Person/Patient
 * in another tenant, the merge operation does NOT validate that the link target belongs
 * to the same tenant. This creates a cross-tenant data link allowing unauthorized access.
 *
 * Attack vector: User with write access to tenant_a merges a Person with
 * link[].target.reference = "Person/person-in-tenant-b". The system creates the link
 * without verifying the target Person's owner/access tags match the source Person's tenant.
 *
 * Files:
 * - src/operations/merge/mergeManager.js (no link target tenant validation)
 * - src/admin/adminPersonPatientLinkManager.js (createPersonToPersonLinkAsync — no tenant check)
 * - src/operations/security/scopesManager.js (line 128-134: patient scope bypasses access check)
 *
 * VULNERABILITY 2 — Patch Security Tag Escalation:
 * The patchInternalFieldsValidator blocks fields starting with '_' but does NOT block
 * modifications to meta.security, meta.source, meta.versionId, or meta.lastUpdated.
 * A user can PATCH meta.security to change owner/access tags and steal resources or
 * inject access for unauthorized tenants.
 *
 * File: src/operations/patch/validators/patchInternalFieldsValidator.js
 *
 * VULNERABILITY 3 — Patient Scope Bypasses Access Tag Check:
 * In scopesManager.isAccessToResourceAllowedBySecurityTags, when patient scopes are
 * present for a patient-filterable resource type, the method returns true immediately
 * without checking owner/access tags. This allows cross-tenant writes.
 *
 * File: src/operations/security/scopesManager.js (line 128-134)
 *
 * All tests assert CORRECT behavior and will FAIL on the current buggy code.
 */
const { describe, test, expect, beforeEach, jest: jestGlobal } = require('@jest/globals');

// ============ Mocks ============

jestGlobal.mock('../../../../utils/assertType', () => ({
    assertIsValid: () => {},
    assertTypeEquals: () => {}
}));

const { ScopesManager } = require('../../../../operations/security/scopesManager');
const { PatientFilterManager } = require('../../../../fhir/patientFilterManager');
const { ConfigManager } = require('../../../../utils/configManager');
const { SecurityTagSystem } = require('../../../../utils/securityTagSystem');
const {
    validatePatchDoesNotTargetInternalFields
} = require('../../../../operations/patch/validators/patchInternalFieldsValidator');

// ============ Helpers ============

function createMockInstance(ClassType) {
    return Object.create(ClassType.prototype);
}

function makePersonResource({ id, uuid, owner, access, sourceAssigningAuthority, links = [] }) {
    const security = [];
    if (owner) {
        security.push({ system: SecurityTagSystem.owner, code: owner });
    }
    if (access) {
        security.push({ system: SecurityTagSystem.access, code: access });
    }
    if (sourceAssigningAuthority) {
        security.push({ system: SecurityTagSystem.sourceAssigningAuthority, code: sourceAssigningAuthority });
    }
    return {
        resourceType: 'Person',
        id,
        _uuid: uuid || `uuid-${id}`,
        _sourceAssigningAuthority: sourceAssigningAuthority || owner,
        meta: {
            security,
            versionId: '1',
            lastUpdated: '2024-01-01T00:00:00.000Z',
            source: 'https://source.example.com'
        },
        link: links.map(ref => ({
            target: { reference: ref }
        }))
    };
}

function makePatientResource({ id, uuid, owner, access, sourceAssigningAuthority }) {
    const security = [];
    if (owner) {
        security.push({ system: SecurityTagSystem.owner, code: owner });
    }
    if (access) {
        security.push({ system: SecurityTagSystem.access, code: access });
    }
    if (sourceAssigningAuthority) {
        security.push({ system: SecurityTagSystem.sourceAssigningAuthority, code: sourceAssigningAuthority });
    }
    return {
        resourceType: 'Patient',
        id,
        _uuid: uuid || `uuid-${id}`,
        _sourceAssigningAuthority: sourceAssigningAuthority || owner,
        meta: {
            security,
            versionId: '1',
            lastUpdated: '2024-01-01T00:00:00.000Z',
            source: 'https://source.example.com'
        }
    };
}

// ============ Test Suite ============

describe('Cross-Tenant Merge Security — Person/Patient Link Injection', () => {
    let scopesManager;

    beforeEach(() => {
        const mockConfigManager = createMockInstance(ConfigManager);
        const patientFilterManager = new PatientFilterManager();

        scopesManager = new ScopesManager({
            configManager: mockConfigManager,
            patientFilterManager
        });
    });

    describe('Person merge with cross-tenant link target', () => {
        test('MUST deny merge of Person with link to Person in different tenant', () => {
            /**
             * Scenario: User has access/tenant_a scope. They attempt to merge a Person
             * resource that contains a link pointing to a Person owned by tenant_b.
             * The merge should be rejected because the link target is in a different tenant.
             *
             * Current Bug: The mergeManager does NOT validate that link targets belong
             * to the same tenant as the source resource. No cross-reference tenant check
             * exists in the merge path.
             */
            const personInTenantA = makePersonResource({
                id: 'person-a',
                owner: 'tenant_a',
                access: 'tenant_a',
                sourceAssigningAuthority: 'tenant_a',
                links: ['Person/person-in-tenant-b']
            });

            const personInTenantB = makePersonResource({
                id: 'person-in-tenant-b',
                owner: 'tenant_b',
                access: 'tenant_b',
                sourceAssigningAuthority: 'tenant_b'
            });

            // CORRECT BEHAVIOR: The system must validate that link targets belong to
            // the same tenant. isAccessToResourceAllowedBySecurityTags should return
            // false when the user has access/tenant_a but the target resource has
            // owner=tenant_b, access=tenant_b.
            const result = scopesManager.isAccessToResourceAllowedBySecurityTags({
                resource: personInTenantB,
                user: 'service-account@tenant_a',
                scope: 'patient/Person.write access/tenant_a.*',
                accessRequested: 'write'
            });

            // The system MUST deny access to the cross-tenant Person
            // BUG: Returns true because patient scope is present and Person is patient-filterable
            expect(result).toBe(false);
        });

        test('MUST deny merge of Person with link to Patient in different tenant', () => {
            /**
             * Scenario: A Person in tenant_a is merged with a link to Patient in tenant_b.
             * This creates a cross-tenant association that allows data from tenant_b's
             * Patient to be accessible through tenant_a's Person graph traversal.
             */
            const crossTenantPatient = makePatientResource({
                id: 'patient-tenant-b',
                owner: 'tenant_b',
                access: 'tenant_b',
                sourceAssigningAuthority: 'tenant_b'
            });

            const result = scopesManager.isAccessToResourceAllowedBySecurityTags({
                resource: crossTenantPatient,
                user: 'user@tenant_a',
                scope: 'patient/Patient.write access/tenant_a.*',
                accessRequested: 'write'
            });

            // MUST return false: user from tenant_a cannot write to tenant_b's Patient
            expect(result).toBe(false);
        });

        test('MUST deny when patient scope present but resource belongs to different tenant', () => {
            /**
             * This tests the core bug in scopesManager.isAccessToResourceAllowedBySecurityTags:
             * When patient scopes are present, it returns true unconditionally for
             * patient-filterable resources WITHOUT checking owner/access tags.
             *
             * The TODO comment on line 133 of scopesManager.js even acknowledges this:
             * "// TODO: should double check here that the resources belong to this patient"
             */
            const resourceInOtherTenant = {
                resourceType: 'Observation',
                id: 'obs-other-tenant',
                meta: {
                    security: [
                        { system: SecurityTagSystem.owner, code: 'tenant_b' },
                        { system: SecurityTagSystem.access, code: 'tenant_b' }
                    ]
                }
            };

            const result = scopesManager.isAccessToResourceAllowedBySecurityTags({
                resource: resourceInOtherTenant,
                user: 'attacker@tenant_a',
                scope: 'patient/Observation.read access/tenant_a.*',
                accessRequested: 'read'
            });

            // MUST return false: tenant_a user should NOT access tenant_b resources
            // BUG: Returns true because patient/Observation scope is present and
            // Observation is patient-filterable
            expect(result).toBe(false);
        });

        test('MUST deny write to cross-tenant Person even with wildcard patient scope', () => {
            /**
             * Even with patient/*.write scope, writing to resources in another tenant
             * must be denied when the user's access codes do not include the target tenant.
             */
            const personOtherTenant = makePersonResource({
                id: 'person-other',
                owner: 'competitor_health',
                access: 'competitor_health',
                sourceAssigningAuthority: 'competitor_health'
            });

            const result = scopesManager.isAccessToResourceAllowedBySecurityTags({
                resource: personOtherTenant,
                user: 'user@my_health',
                scope: 'patient/*.write access/my_health.*',
                accessRequested: 'write'
            });

            // MUST be false
            expect(result).toBe(false);
        });
    });

    describe('Access tag enforcement for merge operations', () => {
        test('MUST enforce access tag check even when patient scope grants resource-type access', () => {
            /**
             * The presence of a patient scope (e.g., patient/Condition.write) should NOT
             * bypass the access tag check. A user with access/tenant_a should not be able
             * to write to resources tagged with access=tenant_b, regardless of patient scope.
             */
            const conditionInOtherTenant = {
                resourceType: 'Condition',
                id: 'condition-1',
                meta: {
                    security: [
                        { system: SecurityTagSystem.owner, code: 'hospital_b' },
                        { system: SecurityTagSystem.access, code: 'hospital_b' }
                    ]
                }
            };

            const result = scopesManager.isAccessToResourceAllowedBySecurityTags({
                resource: conditionInOtherTenant,
                user: 'clinician@hospital_a',
                scope: 'patient/Condition.write access/hospital_a.*',
                accessRequested: 'write'
            });

            expect(result).toBe(false);
        });

        test('MUST allow access when patient scope AND access tags match', () => {
            /**
             * Sanity check: when the user has both patient scope and matching access codes,
             * the access should be allowed.
             */
            const ownedResource = {
                resourceType: 'Observation',
                id: 'my-obs',
                meta: {
                    security: [
                        { system: SecurityTagSystem.owner, code: 'my_tenant' },
                        { system: SecurityTagSystem.access, code: 'my_tenant' }
                    ]
                }
            };

            const result = scopesManager.isAccessToResourceAllowedBySecurityTags({
                resource: ownedResource,
                user: 'user@my_tenant',
                scope: 'patient/Observation.write access/my_tenant.*',
                accessRequested: 'write'
            });

            // This should be allowed (same tenant)
            expect(result).toBe(true);
        });

        test('MUST deny when no access scope matches resource owner/access tags (no patient scope)', () => {
            /**
             * Without patient scope, the system correctly checks access tags.
             * This test confirms baseline behavior is correct in the non-patient-scope path.
             */
            const otherTenantResource = {
                resourceType: 'Observation',
                id: 'other-obs',
                meta: {
                    security: [
                        { system: SecurityTagSystem.owner, code: 'tenant_b' },
                        { system: SecurityTagSystem.access, code: 'tenant_b' }
                    ]
                }
            };

            const result = scopesManager.isAccessToResourceAllowedBySecurityTags({
                resource: otherTenantResource,
                user: 'user@tenant_a',
                scope: 'user/Observation.write access/tenant_a.*',
                accessRequested: 'write'
            });

            // Without patient scope, the access tag check runs and correctly denies
            expect(result).toBe(false);
        });
    });
});

describe('Cross-Tenant Patch Security — meta.security Modification', () => {
    describe('PATCH must block modifications to security-sensitive meta fields', () => {
        test('MUST reject patch replacing owner security tag to hijack resource ownership', () => {
            /**
             * Attack: User patches their own resource's owner tag to 'victim_tenant',
             * effectively transferring ownership. The resource becomes invisible to its
             * original tenant and accessible only to the attacker's chosen tenant.
             */
            const patchContent = [
                { op: 'replace', path: '/meta/security/0/code', value: 'attacker_tenant' }
            ];

            expect(() => {
                validatePatchDoesNotTargetInternalFields(patchContent);
            }).toThrow();
        });

        test('MUST reject patch adding new access tag to gain multi-tenant visibility', () => {
            /**
             * Attack: User adds an additional access tag to their resource so that another
             * tenant can see it. This leaks data across tenant boundaries.
             */
            const patchContent = [
                {
                    op: 'add',
                    path: '/meta/security/-',
                    value: {
                        system: 'https://www.icanbwell.com/access',
                        code: 'unauthorized_tenant'
                    }
                }
            ];

            expect(() => {
                validatePatchDoesNotTargetInternalFields(patchContent);
            }).toThrow();
        });

        test('MUST reject patch removing security tag to orphan resource from tenant', () => {
            /**
             * Attack: Removing the owner or access security tag makes the resource
             * inaccessible to the original tenant, causing data loss.
             */
            const patchContent = [
                { op: 'remove', path: '/meta/security/0' }
            ];

            expect(() => {
                validatePatchDoesNotTargetInternalFields(patchContent);
            }).toThrow();
        });

        test('MUST reject patch replacing entire meta.security array', () => {
            /**
             * Attack: Replace the entire security array to take full control of
             * who can access the resource.
             */
            const patchContent = [
                {
                    op: 'replace',
                    path: '/meta/security',
                    value: [
                        { system: 'https://www.icanbwell.com/owner', code: 'hijacked_tenant' },
                        { system: 'https://www.icanbwell.com/access', code: 'hijacked_tenant' }
                    ]
                }
            ];

            expect(() => {
                validatePatchDoesNotTargetInternalFields(patchContent);
            }).toThrow();
        });

        test('MUST reject patch modifying meta.source (provenance tampering)', () => {
            /**
             * meta.source indicates data provenance. Allowing modification enables
             * an attacker to disguise the origin of data.
             */
            const patchContent = [
                { op: 'replace', path: '/meta/source', value: 'https://evil-source.com' }
            ];

            expect(() => {
                validatePatchDoesNotTargetInternalFields(patchContent);
            }).toThrow();
        });

        test('MUST reject patch modifying meta.versionId (version manipulation)', () => {
            /**
             * Manipulating versionId can cause merge conflicts, bypass optimistic
             * concurrency control, and corrupt version history.
             */
            const patchContent = [
                { op: 'replace', path: '/meta/versionId', value: '999' }
            ];

            expect(() => {
                validatePatchDoesNotTargetInternalFields(patchContent);
            }).toThrow();
        });

        test('MUST reject patch modifying meta.lastUpdated (timestamp manipulation)', () => {
            /**
             * Modifying lastUpdated can bypass audit trails and hide when data was
             * actually modified.
             */
            const patchContent = [
                { op: 'replace', path: '/meta/lastUpdated', value: '2000-01-01T00:00:00Z' }
            ];

            expect(() => {
                validatePatchDoesNotTargetInternalFields(patchContent);
            }).toThrow();
        });

        test('MUST reject patch using add on /meta/security with owner system in value', () => {
            /**
             * Even adding a new entry with the owner system via array append should be blocked.
             */
            const patchContent = [
                {
                    op: 'add',
                    path: '/meta/security/1',
                    value: {
                        system: 'https://www.icanbwell.com/owner',
                        code: 'new_owner'
                    }
                }
            ];

            expect(() => {
                validatePatchDoesNotTargetInternalFields(patchContent);
            }).toThrow();
        });

        test('MUST allow patch modifying clinical data fields (not security-sensitive)', () => {
            /**
             * Sanity check: legitimate patches to clinical data should still work.
             */
            const patchContent = [
                { op: 'replace', path: '/status', value: 'final' },
                { op: 'add', path: '/note/-', value: { text: 'Clinical note' } },
                { op: 'replace', path: '/code/coding/0/display', value: 'Updated display' }
            ];

            expect(() => {
                validatePatchDoesNotTargetInternalFields(patchContent);
            }).not.toThrow();
        });

        test('MUST allow patch modifying meta.tag (non-security user tags)', () => {
            /**
             * meta.tag is user-controlled and distinct from meta.security.
             * Users should be able to modify their own tags.
             */
            const patchContent = [
                {
                    op: 'add',
                    path: '/meta/tag/-',
                    value: { system: 'http://example.org/workflow', code: 'reviewed' }
                }
            ];

            expect(() => {
                validatePatchDoesNotTargetInternalFields(patchContent);
            }).not.toThrow();
        });

        test('MUST allow patch modifying meta.profile (profile declarations)', () => {
            /**
             * meta.profile is a declaration of conformance and should be patchable.
             */
            const patchContent = [
                {
                    op: 'add',
                    path: '/meta/profile/-',
                    value: 'http://hl7.org/fhir/us/core/StructureDefinition/us-core-patient'
                }
            ];

            expect(() => {
                validatePatchDoesNotTargetInternalFields(patchContent);
            }).not.toThrow();
        });
    });
});

describe('Cross-Tenant Merge — Person-to-Person Link Without Tenant Validation', () => {
    let scopesManager;

    beforeEach(() => {
        const mockConfigManager = createMockInstance(ConfigManager);
        const patientFilterManager = new PatientFilterManager();

        scopesManager = new ScopesManager({
            configManager: mockConfigManager,
            patientFilterManager
        });
    });

    test('MUST validate that link target Person belongs to same tenant before creating link', () => {
        /**
         * This test validates the missing cross-tenant check in the Person merge/link path.
         *
         * Attack scenario:
         * 1. Attacker has access to tenant_a
         * 2. Attacker discovers (or guesses) a Person UUID in tenant_b
         * 3. Attacker merges a Person in tenant_a with link[].target = "Person/<tenant_b_person>"
         * 4. System creates the link WITHOUT verifying tenant_b Person's owner/access tags
         * 5. Now tenant_a's Person graph traversal reaches into tenant_b's data
         *
         * The fix: Before creating/updating a Person.link[].target reference, the system
         * must resolve the target resource and verify its owner/access tags match the
         * source Person's tenant. This is currently NOT done.
         *
         * We test this indirectly by verifying the access check infrastructure correctly
         * identifies cross-tenant resources. The actual merge path should call this check
         * for every link target reference.
         */
        const targetPersonInOtherTenant = makePersonResource({
            id: 'person-in-tenant-b',
            uuid: 'uuid-person-tenant-b',
            owner: 'tenant_b',
            access: 'tenant_b',
            sourceAssigningAuthority: 'tenant_b'
        });

        // When access check is properly enforced, accessing tenant_b's Person
        // with tenant_a credentials must fail
        const hasAccess = scopesManager.doesResourceHaveAnyAccessCodeFromThisList(
            ['tenant_a'],
            targetPersonInOtherTenant
        );

        // The target Person has access=tenant_b, so tenant_a should NOT have access
        expect(hasAccess).toBe(false);

        // But the bug is: isAccessToResourceAllowedBySecurityTags bypasses this check
        // when patient scope is present
        const accessGranted = scopesManager.isAccessToResourceAllowedBySecurityTags({
            resource: targetPersonInOtherTenant,
            user: 'service@tenant_a',
            scope: 'patient/Person.write access/tenant_a.*',
            accessRequested: 'write'
        });

        // CORRECT: Must return false because the resource belongs to tenant_b
        // BUG: Returns true because patient/Person scope is present
        expect(accessGranted).toBe(false);
    });

    test('MUST prevent creating cyclic cross-tenant Person links for privilege escalation', () => {
        /**
         * Attack scenario for bidirectional cross-tenant link escalation:
         * 1. Attacker with access to tenant_a creates PersonA -> PersonB link (cross-tenant)
         * 2. Another attacker (or same with dual access) creates PersonB -> PersonA link
         * 3. Graph traversal from either tenant now reaches the other tenant's entire patient graph
         *
         * The merge operation must reject link targets whose resolved owner/access tags
         * do not match the caller's access codes.
         */
        const targetResourceDifferentTenant = {
            resourceType: 'Person',
            id: 'target-person',
            meta: {
                security: [
                    { system: SecurityTagSystem.owner, code: 'other_org' },
                    { system: SecurityTagSystem.access, code: 'other_org' }
                ]
            }
        };

        const result = scopesManager.isAccessToResourceAllowedBySecurityTags({
            resource: targetResourceDifferentTenant,
            user: 'attacker@my_org',
            scope: 'patient/Person.write access/my_org.*',
            accessRequested: 'write'
        });

        // Must deny: cross-tenant Person link creation must be blocked
        expect(result).toBe(false);
    });

    test('MUST correctly identify same-tenant access for legitimate Person links', () => {
        /**
         * Sanity check: Linking Persons within the same tenant should be allowed.
         */
        const sameTenantPerson = makePersonResource({
            id: 'person-same-tenant',
            owner: 'my_org',
            access: 'my_org',
            sourceAssigningAuthority: 'my_org'
        });

        const hasAccess = scopesManager.doesResourceHaveAnyAccessCodeFromThisList(
            ['my_org'],
            sameTenantPerson
        );

        expect(hasAccess).toBe(true);
    });
});
