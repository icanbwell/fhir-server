/**
 * Regression tests for docs/resource-authorization.md §2 "Owner tags (meta.security, system
 * .../owner)".
 *
 * Claims under test, verified against the REAL implementation (no inline stand-ins):
 *   1. The owner tag is NOT part of the bulk search-query filter — SecurityTagManager's Mongo
 *      filter only ever matches on the access system, never the owner system.
 *   2. Single-resource checks like ScopesManager.doesResourceHaveAnyAccessCodeFromThisList
 *      require the caller to match BOTH an owner tag and an access tag on the resource (despite
 *      the "Any" in the name) — and, precisely, the owner-match and the access-match do not have
 *      to come from the SAME code in the caller's list, just some code from the list for each.
 *   3. On write, ScopesManager.isAccessTagChangeAllowedByScopes /
 *      ScopesValidator.isAccessTagChangeAllowedByAccessScopes stop a TENANT/SERVICE-ACCOUNT
 *      caller from adding or removing an access tag for a tenant it isn't itself authorized for.
 *      (The separate, known bug where PATIENT-SCOPED callers bypass this entirely is intentionally
 *      NOT exercised here — every test below forces isAccessAllowedByPatientScopes to return
 *      false via patientFilterManager.canAccessResourceWithPatientScope, so we are strictly on
 *      the tenant/service-account path.)
 */
const { describe, test, expect, beforeEach, jest: jestGlobal } = require('@jest/globals');

jestGlobal.mock('../../../utils/assertType', () => ({
    assertIsValid: () => {},
    assertTypeEquals: () => {}
}));

const { ScopesManager } = require('../../../operations/security/scopesManager');
const { SecurityTagManager } = require('../../../operations/common/securityTagManager');
const { ScopesValidator } = require('../../../operations/security/scopesValidator');
const { SecurityTagSystem } = require('../../../utils/securityTagSystem');

describe('Owner tags (doc §2)', () => {
    describe('The owner tag is not part of the bulk search-query filter', () => {
        let securityTagManager;
        let mockAccessIndexManager;
        let mockR4SearchQueryCreator;

        beforeEach(() => {
            mockAccessIndexManager = {
                resourceHasAccessIndexForAccessCodes: jestGlobal.fn().mockReturnValue(false)
            };
            mockR4SearchQueryCreator = {
                appendAndSimplifyQuery: jestGlobal.fn(({ query, andQuery }) => {
                    if (Object.keys(query).length === 0) {
                        return andQuery;
                    }
                    return { $and: [query, andQuery] };
                })
            };
            securityTagManager = new SecurityTagManager({
                scopesManager: { getAccessCodesFromScopes: jestGlobal.fn() },
                accessIndexManager: mockAccessIndexManager,
                patientFilterManager: {},
                r4SearchQueryCreator: mockR4SearchQueryCreator
            });
        });

        test('getQueryWithSecurityTags only ever filters meta.security on system=access, never system=owner', () => {
            const query = securityTagManager.getQueryWithSecurityTags({
                resourceType: 'Observation',
                securityTags: ['tenantA', 'tenantB'],
                query: {},
                useAccessIndex: false
            });

            expect(query['meta.security'].$elemMatch.system).toEqual(SecurityTagSystem.access);
            expect(query['meta.security'].$elemMatch.system).not.toEqual(SecurityTagSystem.owner);
            expect(JSON.stringify(query)).not.toContain(SecurityTagSystem.owner);
        });

        test('the access-index branch keys on the caller\'s access codes with no owner-tag involvement at all', () => {
            mockAccessIndexManager.resourceHasAccessIndexForAccessCodes.mockReturnValue(true);

            const query = securityTagManager.getQueryWithSecurityTags({
                resourceType: 'Patient',
                securityTags: ['tenantA'],
                query: {},
                useAccessIndex: true
            });

            // The denormalized field is keyed purely by access code - there is no equivalent
            // _owner.<code> field or owner-system check anywhere in the produced query.
            expect(query).toEqual({ '_access.tenantA': 1 });
        });
    });

    describe('ScopesManager.doesResourceHaveAnyAccessCodeFromThisList requires BOTH an owner-tag match AND an access-tag match', () => {
        /** @type {ScopesManager} */
        let scopesManager;

        beforeEach(() => {
            scopesManager = new ScopesManager({
                configManager: { authEnabled: true },
                patientFilterManager: {}
            });
        });

        function resourceWith (ownerCode, accessCode) {
            return {
                resourceType: 'Observation',
                meta: {
                    security: [
                        { system: SecurityTagSystem.owner, code: ownerCode },
                        { system: SecurityTagSystem.access, code: accessCode }
                    ]
                }
            };
        }

        test('returns true when the caller\'s codes cover both the owner tag and the access tag (same code)', () => {
            const resource = resourceWith('tenantA', 'tenantA');
            expect(scopesManager.doesResourceHaveAnyAccessCodeFromThisList(['tenantA'], resource)).toBe(true);
        });

        test('returns false when the caller matches the access tag but NOT the owner tag — the documented gotcha', () => {
            const resource = resourceWith('tenantA', 'tenantB');
            // caller only holds 'tenantB' - matches the access tag, but the owner tag is 'tenantA'
            expect(scopesManager.doesResourceHaveAnyAccessCodeFromThisList(['tenantB'], resource)).toBe(false);
        });

        test('returns false when the caller matches the owner tag but NOT the access tag', () => {
            const resource = resourceWith('tenantA', 'tenantB');
            // caller only holds 'tenantA' - matches the owner tag, but the access tag is 'tenantB'
            expect(scopesManager.doesResourceHaveAnyAccessCodeFromThisList(['tenantA'], resource)).toBe(false);
        });

        test('returns true when the caller\'s list separately covers the owner tag and the access tag via DIFFERENT codes', () => {
            // Precise reading of "Any" in the method name: it means "any code in the caller's
            // list satisfies the owner match" AND (independently) "any code in the caller's list
            // satisfies the access match" - the two matches need not be the SAME code.
            const resource = resourceWith('tenantA', 'tenantB');
            expect(
                scopesManager.doesResourceHaveAnyAccessCodeFromThisList(['tenantA', 'tenantB'], resource)
            ).toBe(true);
        });

        test('the wildcard access code (*) bypasses the owner+access requirement entirely', () => {
            const resource = resourceWith('tenantA', 'tenantB');
            expect(scopesManager.doesResourceHaveAnyAccessCodeFromThisList(['*'], resource)).toBe(true);
        });

        test('returns false when the caller has no access codes at all', () => {
            const resource = resourceWith('tenantA', 'tenantA');
            expect(scopesManager.doesResourceHaveAnyAccessCodeFromThisList([], resource)).toBe(false);
        });

        test('returns false when the resource has no meta.security at all', () => {
            expect(
                scopesManager.doesResourceHaveAnyAccessCodeFromThisList(['tenantA'], { resourceType: 'Observation' })
            ).toBe(false);
        });
    });

    describe('Write-time access-tag change gate (tenant/service-account path only)', () => {
        describe('ScopesManager.isAccessTagChangeAllowedByScopes', () => {
            /** @type {ScopesManager} */
            let scopesManager;
            let mockPatientFilterManager;

            beforeEach(() => {
                mockPatientFilterManager = {
                    // Force isAccessAllowedByPatientScopes() to false for every resource type so
                    // every assertion below is strictly exercising the tenant/service-account
                    // branch, not the separate (and separately tracked) patient-scope bypass.
                    canAccessResourceWithPatientScope: jestGlobal.fn().mockReturnValue(false)
                };
                scopesManager = new ScopesManager({
                    configManager: { authEnabled: true },
                    patientFilterManager: mockPatientFilterManager
                });
            });

            test('rejects adding an access tag for a tenant the caller has no write access to', () => {
                const allowed = scopesManager.isAccessTagChangeAllowedByScopes({
                    oldAccessCodes: ['tenantA'],
                    newAccessCodes: ['tenantA', 'tenantB'],
                    resourceType: 'Observation',
                    user: 'svc-account',
                    scope: 'access/tenantA.write'
                });
                expect(allowed).toBe(false);
            });

            test('allows adding an access tag when the caller holds write access for every changed tag', () => {
                const allowed = scopesManager.isAccessTagChangeAllowedByScopes({
                    oldAccessCodes: ['tenantA'],
                    newAccessCodes: ['tenantA', 'tenantB'],
                    resourceType: 'Observation',
                    user: 'svc-account',
                    scope: 'access/tenantA.write access/tenantB.write'
                });
                expect(allowed).toBe(true);
            });

            test('rejects removing an access tag for a tenant the caller has no write access to', () => {
                const allowed = scopesManager.isAccessTagChangeAllowedByScopes({
                    oldAccessCodes: ['tenantA', 'tenantB'],
                    newAccessCodes: ['tenantA'],
                    resourceType: 'Observation',
                    user: 'svc-account',
                    scope: 'access/tenantA.write'
                });
                expect(allowed).toBe(false);
            });

            test('ignoreRemovals=true skips the removal check (append-only write paths like smart-merge)', () => {
                const allowed = scopesManager.isAccessTagChangeAllowedByScopes({
                    oldAccessCodes: ['tenantA', 'tenantB'],
                    newAccessCodes: ['tenantA'],
                    resourceType: 'Observation',
                    user: 'svc-account',
                    scope: 'access/tenantA.write',
                    ignoreRemovals: true
                });
                expect(allowed).toBe(true);
            });

            test('a caller holding the write wildcard (access/*.write) may add or remove any tag', () => {
                const allowed = scopesManager.isAccessTagChangeAllowedByScopes({
                    oldAccessCodes: ['tenantA'],
                    newAccessCodes: ['tenantB'],
                    resourceType: 'Observation',
                    user: 'admin-svc',
                    scope: 'access/*.write'
                });
                expect(allowed).toBe(true);
            });

            test('no change to access codes is trivially allowed even with no matching write scope', () => {
                const allowed = scopesManager.isAccessTagChangeAllowedByScopes({
                    oldAccessCodes: ['tenantA'],
                    newAccessCodes: ['tenantA'],
                    resourceType: 'Observation',
                    user: 'svc-account',
                    scope: 'access/tenantZ.write'
                });
                expect(allowed).toBe(true);
            });
        });

        describe('ScopesValidator.isAccessTagChangeAllowedByAccessScopes', () => {
            /** @type {ScopesValidator} */
            let scopesValidator;
            /** @type {ScopesManager} */
            let scopesManager;
            let mockPatientFilterManager;

            beforeEach(() => {
                mockPatientFilterManager = {
                    canAccessResourceWithPatientScope: jestGlobal.fn().mockReturnValue(false)
                };
                // Real ScopesManager feeding a real ScopesValidator - the collaborators mocked
                // below (logging, config, patient-scope write checks, pre-save, delegated access)
                // are genuine external services unrelated to the access-tag-change decision itself.
                scopesManager = new ScopesManager({
                    configManager: { authEnabled: true },
                    patientFilterManager: mockPatientFilterManager
                });
                scopesValidator = new ScopesValidator({
                    scopesManager,
                    fhirLoggingManager: { logOperationSuccessAsync: jestGlobal.fn(), logOperationFailureAsync: jestGlobal.fn() },
                    configManager: { authEnabled: true },
                    patientScopeManager: { canWriteResourceAsync: jestGlobal.fn().mockResolvedValue(true) },
                    preSaveManager: { preSaveAsync: jestGlobal.fn(async ({ resource }) => resource) },
                    delegatedAccessScopeManager: { isAccessAllowedAsync: jestGlobal.fn().mockResolvedValue(true) }
                });
            });

            function resourceWithAccessCodes (codes) {
                return {
                    resourceType: 'Observation',
                    id: 'obs1',
                    meta: {
                        security: codes.map((code) => ({ system: SecurityTagSystem.access, code }))
                    }
                };
            }

            test('throws a 403 ForbiddenError when a tenant caller tries to add an access tag it has no write access to', () => {
                const currentResource = resourceWithAccessCodes(['tenantA']);
                const updatedResource = resourceWithAccessCodes(['tenantA', 'tenantB']);

                // Note: httpErrors.js's error subclasses (ForbiddenError etc.) all share a base
                // ServerError constructor that unconditionally does
                // `Object.setPrototypeOf(this, ServerError.prototype)`, which erases the subclass
                // identity for `instanceof` purposes (every instance reports as a plain
                // ServerError). So we assert via statusCode/message rather than
                // `.toThrow(ForbiddenError)`, matching the convention already used in
                // securityTagManager.test.js for the same reason.
                let thrown;
                try {
                    scopesValidator.isAccessTagChangeAllowedByAccessScopes({
                        requestInfo: { user: 'svc-account', scope: 'access/tenantA.write' },
                        currentResource,
                        updatedResource
                    });
                } catch (e) {
                    thrown = e;
                }
                expect(thrown).toBeDefined();
                expect(thrown.statusCode).toBe(403);
                expect(thrown.message).toMatch(/can only add or remove access tags it has write access to/);
            });

            test('does not throw when the tenant caller holds write access for every tag it is changing', () => {
                const currentResource = resourceWithAccessCodes(['tenantA']);
                const updatedResource = resourceWithAccessCodes(['tenantA', 'tenantB']);

                expect(() => {
                    scopesValidator.isAccessTagChangeAllowedByAccessScopes({
                        requestInfo: { user: 'svc-account', scope: 'access/tenantA.write access/tenantB.write' },
                        currentResource,
                        updatedResource
                    });
                }).not.toThrow();
            });

            test('throws a 403 ForbiddenError on create (no currentResource) when stamping an access tag the caller lacks', () => {
                const updatedResource = resourceWithAccessCodes(['tenantB']);

                let thrown;
                try {
                    scopesValidator.isAccessTagChangeAllowedByAccessScopes({
                        requestInfo: { user: 'svc-account', scope: 'access/tenantA.write' },
                        currentResource: null,
                        updatedResource
                    });
                } catch (e) {
                    thrown = e;
                }
                expect(thrown).toBeDefined();
                expect(thrown.statusCode).toBe(403);
            });
        });
    });
});
