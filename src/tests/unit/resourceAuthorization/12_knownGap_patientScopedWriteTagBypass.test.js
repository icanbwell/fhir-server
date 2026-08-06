'use strict';

/**
 * Regression test for a FIXED gap that was tracked in docs/resource-authorization.md §12 —
 * "a patient-scoped write to an EXISTING resource can set an arbitrary access tag."
 *
 * CORRECTION TO THIS FILE'S OWN EARLIER VERSION: an earlier version of this fix removed
 * `ScopesManager.isAccessTagChangeAllowedByScopes`'s patient-scope bypass unconditionally (for
 * both create and update) and additionally modified `isAccessToResourceAllowedBySecurityTags` the
 * same way. That broke a real, legitimate flow —
 * `src/tests/patientScope/create_with_patient_scope/create_with_patient_scope.test.js` — because a
 * patient-scoped app has no `access/` scope on its token to validate a NEW resource's self-assigned
 * owner/access tags against; there is no other mechanism in this codebase for it to declare its own
 * tenant identity on create. That test's fixture (a `Condition` create carrying `owner`/`access`
 * tags of `client`/`B` under a bare `patient/Condition.write` scope, no `access/` scope at all)
 * proved the unconditional version wrong empirically, not just in theory.
 *
 * The corrected fix (matching DCON-4854 / PR #2447, which reached this independently and first):
 * - `isAccessToResourceAllowedBySecurityTags` is NOT changed — its patient-scope bypass is safe
 *   because every real write-path caller ANDs it with `PatientScopeManager.canWriteResourceAsync`
 *   (Person/Patient-id ownership matching) via
 *   `ScopesValidator.isAccessToResourceAllowedByAccessAndPatientScopes`.
 * - `isAccessTagChangeAllowedByScopes` gets a new `isCreate` parameter
 *   (`ScopesValidator.isAccessTagChangeAllowedByAccessScopes` passes `isCreate: !currentResource`).
 *   The patient-scope bypass now applies ONLY when `isCreate` is true. A write to an EXISTING
 *   resource always goes through the real old-vs-new comparison, regardless of caller type.
 *
 * Known, deliberately-unfixed residual gap (tracked, not addressed by this file): a patient-scoped
 * caller can still forge an arbitrary tenant's owner/access tag on CREATE, since there's no
 * server-side source of truth for "this token's own tenant" to validate against on a brand-new
 * resource. Tightening this without breaking legitimate creates would need a different mechanism
 * entirely (e.g. deriving the allowed tag from the OAuth client/JWT itself) and is out of scope
 * here.
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

describe('§12 known gap — patient-scoped update can set an arbitrary access tag ' +
    '(create-path is intentionally permissive, see file header)', () => {
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

    describe('isAccessTagChangeAllowedByScopes — update path (isCreate: false)', () => {
        test('a patient-scoped caller with no access/ scope must not be allowed to change an ' +
            'EXISTING resource\'s access tag to a tenant it has no relationship with', () => {
            const result = scopesManager.isAccessTagChangeAllowedByScopes({
                oldAccessCodes: ['tenant_a'],
                newAccessCodes: ['tenant_b'],
                resourceType: 'Observation',
                user: 'patient-user@tenant_a',
                scope: 'patient/Observation.write',
                isCreate: false
            });

            expect(result).toBe(false);
        });

        test('a patient-scoped caller may write an existing resource whose access tags are ' +
            'unchanged, even with no access/ scope of its own', () => {
            // The common legitimate case: an update that never touches the access tag at all.
            // Reachability via the patient-scope identity graph is the only applicable signal
            // here — this must keep working.
            const result = scopesManager.isAccessTagChangeAllowedByScopes({
                oldAccessCodes: ['tenant_a'],
                newAccessCodes: ['tenant_a'],
                resourceType: 'Observation',
                user: 'patient-user@tenant_a',
                scope: 'patient/Observation.write',
                isCreate: false
            });

            expect(result).toBe(true);
        });

        test('a patient-scoped caller that also holds a matching access/ scope for its own ' +
            'tenant may change an existing resource to that tenant\'s tag', () => {
            // Realistic combined scope for a tenant's own patient-facing app: patient/* + access/<tenant>.
            const result = scopesManager.isAccessTagChangeAllowedByScopes({
                oldAccessCodes: ['tenant_a'],
                newAccessCodes: ['tenant_a', 'tenant_c'],
                resourceType: 'Observation',
                user: 'patient-user@tenant_a',
                scope: 'patient/Observation.write access/tenant_c.write',
                isCreate: false
            });

            expect(result).toBe(true);
        });

        test('that same combined-scope caller still cannot add a tag for a THIRD tenant it has ' +
            'no relationship with, on an existing resource', () => {
            const result = scopesManager.isAccessTagChangeAllowedByScopes({
                oldAccessCodes: ['tenant_a'],
                newAccessCodes: ['tenant_a', 'tenant_evil'],
                resourceType: 'Observation',
                user: 'patient-user@tenant_a',
                scope: 'patient/Observation.write access/tenant_c.write',
                isCreate: false
            });

            expect(result).toBe(false);
        });
    });

    describe('isAccessTagChangeAllowedByScopes — create path (isCreate: true, intentionally ' +
        'permissive — see file header for why)', () => {
        test('a patient-scoped caller with no access/ scope MAY set its own owner/access tags on ' +
            'a brand-new resource (matches the real create_with_patient_scope.test.js fixture)', () => {
            const result = scopesManager.isAccessTagChangeAllowedByScopes({
                oldAccessCodes: [],
                newAccessCodes: ['client', 'B'],
                resourceType: 'Condition',
                user: 'patient-123@example.com',
                scope: 'patient/Condition.write',
                isCreate: true
            });

            expect(result).toBe(true);
        });

        test('a patient-scoped caller with no access/ scope can also set an UNRELATED tenant\'s ' +
            'tag on create — the known, deliberately-unfixed residual gap', () => {
            const result = scopesManager.isAccessTagChangeAllowedByScopes({
                oldAccessCodes: [],
                newAccessCodes: ['tenant_evil'],
                resourceType: 'Observation',
                user: 'patient-user@tenant_a',
                scope: 'patient/Observation.write',
                isCreate: true
            });

            // Documents current, accepted behavior — not asserting this is ideal, just real.
            expect(result).toBe(true);
        });
    });

    describe('isAccessToResourceAllowedBySecurityTags — intentionally unchanged (not this bug)', () => {
        test('a patient-scoped caller is allowed access to a resource regardless of its owner/' +
            'access tags — ownership is independently enforced elsewhere in the write path, not here', () => {
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

            expect(result).toBe(true);
        });

        test('a patient-scoped caller is allowed access to a resource with no access/owner tags ' +
            'at all too', () => {
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
    });
});
