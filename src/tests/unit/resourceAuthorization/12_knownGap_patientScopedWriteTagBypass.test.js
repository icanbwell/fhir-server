'use strict';

/**
 * Regression test for a FIXED gap that was tracked in docs/resource-authorization.md §12
 * "Known gaps in the current implementation" — the "Critical — a patient-scoped write can set
 * an arbitrary access tag" finding.
 *
 * Originally written as `test.failing` (Jest 30) to document a real, then-unfixed bug. The fix
 * removed `ScopesManager.isAccessTagChangeAllowedByScopes`'s unconditional `return true` for
 * patient-scoped callers, so the old-vs-new access-code comparison now runs for every caller,
 * including patient-scoped ones. This is now a plain `test(...)` asserting the fixed behavior —
 * if this ever regresses, it fails normally rather than needing a `test.failing` inversion.
 *
 * Background (kept for context; see docs/resource-authorization.md §12 for the historical write-up):
 *   Before the fix, `isAccessTagChangeAllowedByScopes` (src/operations/security/scopesManager.js)
 *   returned `true` immediately once the caller held a `patient/` scope for the resource type,
 *   without ever comparing the resource's old vs. new `meta.security` access-tag values. That
 *   allowed a patient-scoped caller to write a resource belonging to their own patient while
 *   stamping it with an access tag for an unrelated tenant.
 *
 *   The bypass had been reintroduced by commit a5ded4a4a ("DCON-4806 revert
 *   isAccessToResourceAllowedBySecurityTags tag-match requirement"), which reverted a similar fix
 *   to a *different* function (`isAccessToResourceAllowedBySecurityTags`) based on the premise
 *   that patient-scoped tokens in this system never carry an `access/` scope of their own. That
 *   premise turned out to be false — `src/tests/unit/operations/update/conditionalCrossTenant.test.js`
 *   and `scopesManager.writeBypass.test.js` (both pre-existing, CI-excluded) already modeled scopes
 *   like `patient/Patient.write access/tenant_b.*`, i.e. a patient scope legitimately combined with
 *   an access scope for the token's own tenant. The fix for both functions restores the original,
 *   more nuanced logic: bypass the tag check only when the resource carries no access/owner tags at
 *   all (nothing to validate against); otherwise fall through to the normal tag-matching comparison
 *   for every caller, patient-scoped or not.
 *
 * Finding 4 from §12 (Composition section filter not folding in the hardcoded `unclassified` code)
 * remains open and is covered as a documenting (non-failing) test in `10_delegatedActorAccess.test.js`.
 */
const { describe, test, expect, beforeEach, jest: jestGlobal } = require('@jest/globals');

// ScopesManager's constructor type-checks its collaborators with assertTypeEquals(obj, Class),
// which requires real `instanceof` matches. We only need lightweight stand-ins for
// ConfigManager/PatientFilterManager here, so neutralize the type check the same way the
// (reverted, CI-excluded) scopesManager.crossTenant.test.js / scopesManager.writeBypass.test.js
// files did, while keeping assertIsValid's truthiness semantics intact.
jestGlobal.mock('../../../utils/assertType', () => ({
    assertIsValid: (obj, message) => {
        if (!obj) {
            throw new Error(message || 'obj is null or undefined');
        }
    },
    assertTypeEquals: () => {}
}));

const { ScopesManager } = require('../../../operations/security/scopesManager');

describe('§12 known gap — patient-scoped write can set an arbitrary access tag', () => {
    /** @type {ScopesManager} */
    let scopesManager;

    beforeEach(() => {
        const mockConfigManager = {
            authEnabled: true
        };
        const mockPatientFilterManager = {
            // Observation is patient-filterable, matching a real deployment's config.
            canAccessResourceWithPatientScope: jestGlobal.fn().mockReturnValue(true)
        };
        scopesManager = new ScopesManager({
            configManager: mockConfigManager,
            patientFilterManager: mockPatientFilterManager
        });
    });

    test('a patient-scoped caller with no access/ scope must not be allowed to change a resource ' +
        'access tag to a tenant it has no relationship with', () => {
        // Caller holds only a patient scope for Observation.write — no `access/` scope at all.
        // The resource is being changed from tenant_a's access tag to tenant_b's.
        const result = scopesManager.isAccessTagChangeAllowedByScopes({
            oldAccessCodes: ['tenant_a'],
            newAccessCodes: ['tenant_b'],
            resourceType: 'Observation',
            user: 'patient-user@tenant_a',
            scope: 'patient/Observation.write'
        });

        // The caller has no authorization from tenant_b (or tenant_a) to make this change.
        expect(result).toBe(false);
    });

    test('a patient-scoped caller may not add a brand-new access tag on create without holding ' +
        'a matching access/ scope', () => {
        const result = scopesManager.isAccessTagChangeAllowedByScopes({
            oldAccessCodes: [], // create: no pre-existing resource
            newAccessCodes: ['tenant_b'],
            resourceType: 'Observation',
            user: 'patient-user@tenant_a',
            scope: 'patient/Observation.write'
        });

        expect(result).toBe(false);
    });

    test('a patient-scoped caller may write a resource whose access tags are unchanged, even with ' +
        'no access/ scope of its own', () => {
        // The common legitimate case: a patient-authored resource that never carries (or never
        // changes) an access tag at all. Reachability via the patient-scope identity graph is the
        // only applicable signal here — this must keep working after the fix.
        const result = scopesManager.isAccessTagChangeAllowedByScopes({
            oldAccessCodes: [],
            newAccessCodes: [],
            resourceType: 'Observation',
            user: 'patient-user@tenant_a',
            scope: 'patient/Observation.write'
        });

        expect(result).toBe(true);
    });

    test('a patient-scoped caller that also holds a matching access/ scope for its own tenant may ' +
        'set that tenant\'s access tag', () => {
        // Realistic combined scope for a tenant's own patient-facing app: patient/* + access/<tenant>.
        const result = scopesManager.isAccessTagChangeAllowedByScopes({
            oldAccessCodes: [],
            newAccessCodes: ['tenant_a'],
            resourceType: 'Observation',
            user: 'patient-user@tenant_a',
            scope: 'patient/Observation.write access/tenant_a.write'
        });

        expect(result).toBe(true);
    });

    describe('isAccessToResourceAllowedBySecurityTags (the sibling function fixed alongside this one)', () => {
        test('a patient-scoped caller with no access/ scope is denied access to a resource tagged ' +
            "for a tenant it has no relationship with", () => {
            const resource = {
                resourceType: 'Observation',
                id: 'obs-1',
                meta: {
                    security: [
                        { system: 'https://www.icanbwell.com/owner', code: 'tenant_b' },
                        { system: 'https://www.icanbwell.com/access', code: 'tenant_b' }
                    ]
                }
            };

            const result = scopesManager.isAccessToResourceAllowedBySecurityTags({
                resource,
                user: 'patient-user@tenant_a',
                scope: 'patient/Observation.write',
                accessRequested: 'write'
            });

            expect(result).toBe(false);
        });

        test('a patient-scoped caller may access a resource that carries no access/owner tags at ' +
            'all, based on patient-graph reachability alone', () => {
            const resource = {
                resourceType: 'Observation',
                id: 'obs-2',
                meta: {}
            };

            const result = scopesManager.isAccessToResourceAllowedBySecurityTags({
                resource,
                user: 'patient-user@tenant_a',
                scope: 'patient/Observation.write',
                accessRequested: 'write'
            });

            expect(result).toBe(true);
        });

        test('a patient-scoped caller holding a matching access/ scope may access a resource tagged ' +
            'for that same tenant', () => {
            // doesResourceHaveAnyAccessCodeFromThisList (used by the function under test) requires
            // BOTH an owner tag and an access tag match, despite what its name might suggest — see
            // §2 of docs/resource-authorization.md — so this resource needs both.
            const resource = {
                resourceType: 'Observation',
                id: 'obs-3',
                meta: {
                    security: [
                        { system: 'https://www.icanbwell.com/owner', code: 'tenant_a' },
                        { system: 'https://www.icanbwell.com/access', code: 'tenant_a' }
                    ]
                }
            };

            const result = scopesManager.isAccessToResourceAllowedBySecurityTags({
                resource,
                user: 'patient-user@tenant_a',
                scope: 'patient/Observation.write access/tenant_a.write',
                accessRequested: 'write'
            });

            expect(result).toBe(true);
        });
    });
});
