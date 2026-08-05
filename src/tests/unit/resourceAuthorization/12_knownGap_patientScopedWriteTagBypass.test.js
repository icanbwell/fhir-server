'use strict';

/**
 * Regression test tracking a KNOWN, DOCUMENTED gap from docs/resource-authorization.md §12
 * "Known gaps in the current implementation" — the "Critical — a patient-scoped write can set
 * an arbitrary access tag" finding.
 *
 * This is intentionally a `test.failing` (Jest 30): the assertion below encodes CORRECT behavior
 * that `ScopesManager.isAccessTagChangeAllowedByScopes` does not currently implement. The test
 * SUCCEEDS (green) as long as the assertion keeps failing internally, i.e. as long as the bug is
 * still present. If someone fixes the bug and forgets to flip this back to `test(...)`, this file
 * turns red in CI, which is the whole point.
 *
 * Do NOT read this as new/undiscovered — it documents an already-known, already-reviewed gap.
 *
 * Background (see docs/resource-authorization.md §12 for the full write-up):
 *   `ScopesManager.isAccessTagChangeAllowedByScopes` (src/operations/security/scopesManager.js:166)
 *   returns `true` immediately once the caller holds a `patient/` scope for the resource type
 *   (via `isAccessAllowedByPatientScopes`), without ever comparing the resource's old vs. new
 *   `meta.security` access-tag values. The only other write-path check for patient-scoped callers,
 *   `PatientScopeManager.canWriteResourceAsync` (src/operations/security/patientScopeManager.js:277),
 *   validates that the resource's `patient`/`subject` reference belongs to the caller, but it never
 *   inspects `meta.security` either. So a patient-scoped caller can legitimately write a resource
 *   that belongs to their own patient while stamping it with an access tag for a tenant they have
 *   no relationship with — silently granting (create) or revoking (update) that tenant's
 *   visibility into the resource, with no authorization from that tenant ever checked.
 *
 *   This was reintroduced by commit a5ded4a4a ("DCON-4806 revert
 *   isAccessToResourceAllowedBySecurityTags tag-match requirement"), whose own (still-present but
 *   CI-excluded) test files `scopesManager.crossTenant.test.js` / `scopesManager.writeBypass.test.js`
 *   exercise a *different* function, `isAccessToResourceAllowedBySecurityTags`. That revert's
 *   commit message correctly explains why treating THAT function's premature `return true` as a bug
 *   was a false positive: it only ever validates single-resource access, never a tag *change*, and
 *   the "does this resource belong to this patient" question it was trying to re-derive is already
 *   answered independently by `canWriteResourceAsync`. This file therefore does not re-test
 *   `isAccessToResourceAllowedBySecurityTags` (that would repeat the false-positive mistake this
 *   comment just described). Instead it targets `isAccessTagChangeAllowedByScopes`, which is a
 *   distinct function whose entire purpose is to compare old vs. new access tags — and which has no
 *   fallback anywhere else in the write path once it short-circuits for a patient scope.
 *
 * Finding 4 from §12 (Composition section filter not folding in the hardcoded `unclassified` code)
 * is intentionally NOT re-tested in this PR's set of files: it is already covered as a
 * documenting (non-failing) test in `10_delegatedActorAccess.test.js`.
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

    test.failing(
        'a patient-scoped caller must not be allowed to change a resource access tag to a ' +
        'tenant it has no relationship with',
        () => {
            // Caller holds only a patient scope for Observation.write — no `access/` scope at all,
            // which is realistic: patient-scope tokens in this system never carry a tenant/access
            // scope of their own (see scopesManager.js's own comment on isAccessAllowedByPatientScopes
            // usage). The resource is being changed from tenant_a's access tag to tenant_b's.
            const result = scopesManager.isAccessTagChangeAllowedByScopes({
                oldAccessCodes: ['tenant_a'],
                newAccessCodes: ['tenant_b'],
                resourceType: 'Observation',
                user: 'patient-user@tenant_a',
                scope: 'patient/Observation.write'
            });

            // CORRECT behavior: the caller has no authorization from tenant_b (and none from
            // tenant_a either, since it holds no `access/` scope at all) to make this change, so
            // this must be rejected.
            //
            // ACTUAL current behavior: isAccessAllowedByPatientScopes({ scope, resourceType })
            // returns true (patient/ scope + patient-filterable resource type), so
            // isAccessTagChangeAllowedByScopes returns true immediately at scopesManager.js:177,
            // before the old-vs-new access code comparison on lines 187-200 ever runs.
            expect(result).toBe(false);
        }
    );
});
