/**
 * Regression tests for docs/resource-authorization.md §7 "Admin scope and the wildcard bypass".
 *
 * Claims under test, verified against the REAL implementation (no inline stand-ins):
 *   1. There is no dedicated "admin bypass" for tenant filtering. What removes the §1 filter is
 *      the wildcard ACCESS code: when ScopesManager.getAccessCodesFromScopes returns ['*'],
 *      SecurityTagManager.getSecurityTagsFromScope returns an empty tag list, meaning no
 *      meta.security filter is ANDed onto the query at all.
 *   2. The literal admin/ scope namespace (ScopesManager.getAdminScopes,
 *      ScopesValidator.isAdminScope) is a different, narrower mechanism that gates admin routes
 *      and debug/explain query params - NOT a tenant-filter bypass. Holding admin/*.* does not,
 *      by itself, bypass access-tag filtering unless the caller ALSO holds the access/* wildcard.
 *   3. Fail-closed case: SecurityTagManager.getSecurityTagsFromScope throws a ForbiddenError when
 *      the caller has zero access codes AND is not accessing via patient scopes - it must NOT
 *      silently return an empty filter (which would be fail-OPEN).
 */
const { describe, test, expect, beforeEach, jest: jestGlobal } = require('@jest/globals');

jestGlobal.mock('../../../utils/assertType', () => ({
    assertIsValid: () => {},
    assertTypeEquals: () => {}
}));

const { ScopesManager } = require('../../../operations/security/scopesManager');
const { SecurityTagManager } = require('../../../operations/common/securityTagManager');
const { ScopesValidator } = require('../../../operations/security/scopesValidator');

describe('Admin scope and the wildcard bypass (doc §7)', () => {
    /** @type {ScopesManager} */
    let scopesManager;
    /** @type {SecurityTagManager} */
    let securityTagManager;
    let mockAccessIndexManager;
    let mockR4SearchQueryCreator;

    beforeEach(() => {
        scopesManager = new ScopesManager({
            configManager: { authEnabled: true },
            patientFilterManager: {}
        });
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
        // Real ScopesManager wired into a real SecurityTagManager, so the parsing done by one
        // is the exact input consumed by the other - not two independently-stubbed halves.
        securityTagManager = new SecurityTagManager({
            scopesManager,
            accessIndexManager: mockAccessIndexManager,
            patientFilterManager: {},
            r4SearchQueryCreator: mockR4SearchQueryCreator
        });
    });

    describe('The access/* wildcard removes the §1 filter entirely', () => {
        test('access/*.read parses to the wildcard access code', () => {
            const codes = scopesManager.getAccessCodesFromScopes('read', 'user1', 'access/*.read');
            expect(codes).toEqual(['*']);
        });

        test('access/*.* parses to the wildcard access code for any requested action', () => {
            expect(scopesManager.getAccessCodesFromScopes('read', 'user1', 'access/*.*')).toEqual(['*']);
            expect(scopesManager.getAccessCodesFromScopes('write', 'user1', 'access/*.*')).toEqual(['*']);
        });

        test('a caller holding access/*.read gets an EMPTY security-tag list from getSecurityTagsFromScope', () => {
            const tags = securityTagManager.getSecurityTagsFromScope({
                user: 'user1',
                scope: 'access/*.read',
                accessViaPatientScopes: false,
                accessRequested: 'read'
            });
            expect(tags).toEqual([]);
        });

        test('an empty security-tag list means getQueryWithSecurityTags leaves the query completely unchanged (no meta.security filter at all)', () => {
            const originalQuery = { resourceType: 'Patient' };
            const tags = securityTagManager.getSecurityTagsFromScope({
                user: 'user1',
                scope: 'access/*.read',
                accessViaPatientScopes: false,
                accessRequested: 'read'
            });

            const finalQuery = securityTagManager.getQueryWithSecurityTags({
                resourceType: 'Patient',
                securityTags: tags,
                query: originalQuery,
                useAccessIndex: true
            });

            expect(finalQuery).toEqual(originalQuery);
            expect(mockR4SearchQueryCreator.appendAndSimplifyQuery).not.toHaveBeenCalled();
        });

        test('the wildcard bypass holds even when mixed in with other explicit tenant scopes', () => {
            const tags = securityTagManager.getSecurityTagsFromScope({
                user: 'user1',
                scope: 'access/tenantA.read access/*.read access/tenantB.read',
                accessViaPatientScopes: false,
                accessRequested: 'read'
            });
            expect(tags).toEqual([]);
        });
    });

    describe('admin/ scope is a separate, narrower mechanism that does NOT by itself bypass tenant filtering', () => {
        test('holding admin/*.* with no access/ scope at all still fails closed (no access scope != admin bypass)', () => {
            expect(() => {
                securityTagManager.getSecurityTagsFromScope({
                    user: 'admin-user',
                    scope: 'admin/*.* user/Patient.read',
                    accessViaPatientScopes: false,
                    accessRequested: 'read'
                });
            }).toThrow();
        });

        test('holding admin/*.* alongside a narrow tenant access scope still filters by that tenant - admin does not widen it', () => {
            const tags = securityTagManager.getSecurityTagsFromScope({
                user: 'admin-user',
                scope: 'admin/*.* access/tenantA.read',
                accessViaPatientScopes: false,
                accessRequested: 'read'
            });
            expect(tags).toEqual(['tenantA']);
        });

        test('the bypass only appears once access/* is ALSO present alongside admin/*.* - proving admin/ itself is not the cause', () => {
            const tags = securityTagManager.getSecurityTagsFromScope({
                user: 'admin-user',
                scope: 'admin/*.* access/*.read',
                accessViaPatientScopes: false,
                accessRequested: 'read'
            });
            expect(tags).toEqual([]);
        });

        test('ScopesManager.getAdminScopes extracts admin/ scopes regardless of their resource segment', () => {
            const adminScopes = scopesManager.getAdminScopes({ scope: 'admin/AuditEvent.write admin/*.* user/Patient.read' });
            expect(adminScopes.sort()).toEqual(['admin/*.*', 'admin/AuditEvent.write']);
        });
    });

    describe('ScopesValidator.isAdminScope — gates admin routes / debug params, requires a wildcard resource segment', () => {
        /** @type {ScopesValidator} */
        let scopesValidator;

        beforeEach(() => {
            scopesValidator = new ScopesValidator({
                scopesManager,
                fhirLoggingManager: { logOperationSuccessAsync: jestGlobal.fn(), logOperationFailureAsync: jestGlobal.fn() },
                configManager: { authEnabled: true },
                patientScopeManager: { canWriteResourceAsync: jestGlobal.fn().mockResolvedValue(true) },
                preSaveManager: { preSaveAsync: jestGlobal.fn(async ({ resource }) => resource) },
                delegatedAccessScopeManager: { isAccessAllowedAsync: jestGlobal.fn().mockResolvedValue(true) }
            });
        });

        test('admin/*.* unlocks the debug/explain gate (wildcard resource segment)', () => {
            expect(scopesValidator.isAdminScope({ scope: 'admin/*.*' })).toBe(true);
        });

        test('admin/*.read also unlocks it (wildcard resource segment, any action)', () => {
            expect(scopesValidator.isAdminScope({ scope: 'admin/*.read' })).toBe(true);
        });

        test('a narrow admin grant for a single resource type (admin/AuditEvent.write) does NOT unlock the debug/explain gate', () => {
            expect(scopesValidator.isAdminScope({ scope: 'admin/AuditEvent.write' })).toBe(false);
        });

        test('no admin/ scope at all does not unlock the gate', () => {
            expect(scopesValidator.isAdminScope({ scope: 'user/Patient.read access/*.read' })).toBe(false);
        });

        test('holding admin/*.* (debug-gate unlocked) does not itself imply the access/* tenant-filter bypass', () => {
            // isAdminScope() only decides the debug/explain gate - it says nothing about
            // tenant-filtering, which is decided independently by getSecurityTagsFromScope.
            const scope = 'admin/*.* access/tenantA.read';
            expect(scopesValidator.isAdminScope({ scope })).toBe(true);

            const tags = securityTagManager.getSecurityTagsFromScope({
                user: 'admin-user',
                scope,
                accessViaPatientScopes: false,
                accessRequested: 'read'
            });
            expect(tags).toEqual(['tenantA']); // still filtered - not bypassed
        });
    });

    describe('Fail-closed: zero access codes and no patient-scope access must throw, never silently return an empty (fail-open) filter', () => {
        test('getSecurityTagsFromScope throws a 403 ForbiddenError when there are no access codes and accessViaPatientScopes is false', () => {
            let thrown;
            try {
                securityTagManager.getSecurityTagsFromScope({
                    user: 'user1',
                    scope: 'user/Patient.read', // no access/ scope at all
                    accessViaPatientScopes: false,
                    accessRequested: 'read'
                });
            } catch (e) {
                thrown = e;
            }

            expect(thrown).toBeDefined();
            expect(thrown.statusCode).toBe(403);
            expect(thrown.message).toMatch(/has no access scopes/);
        });

        test('an empty scope string with no patient-scope access also fails closed rather than returning []', () => {
            let thrown;
            try {
                securityTagManager.getSecurityTagsFromScope({
                    user: 'user1',
                    scope: '',
                    accessViaPatientScopes: false,
                    accessRequested: 'read'
                });
            } catch (e) {
                thrown = e;
            }
            expect(thrown).toBeDefined();
            expect(thrown.statusCode).toBe(403);
        });

        test('by contrast, zero access codes WITH accessViaPatientScopes=true does not throw (patient-scope path is a legitimate exception)', () => {
            expect(() => {
                securityTagManager.getSecurityTagsFromScope({
                    user: 'patient-user',
                    scope: 'patient/Patient.read',
                    accessViaPatientScopes: true,
                    accessRequested: 'read'
                });
            }).not.toThrow();
        });
    });
});
