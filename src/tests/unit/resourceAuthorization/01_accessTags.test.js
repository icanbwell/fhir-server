/**
 * Regression tests for docs/resource-authorization.md §1 "Access tags (meta.security, system
 * .../access)".
 *
 * Claims under test, verified against the REAL implementation (no inline stand-ins):
 *   1. ScopesManager.getAccessCodesFromScopes parses `access/<tag>.<read|write|*>` scopes into
 *      the caller's authorized access codes.
 *   2. SecurityTagManager.getSecurityTagsFromScope / getQueryWithSecurityTags turn those codes
 *      into the actual Mongo filter ANDed onto every query - either a meta.security $elemMatch
 *      scan, or a denormalized `_access.<code>: 1` field lookup when an access index exists for
 *      the collection AND the caller passed useAccessIndex: true.
 *   3. A resource with multiple access tags is visible to ANY tenant whose scope matches at
 *      least one of them (shared visibility, encoded as an $in / $or membership check rather than
 *      an $all / $and requirement).
 *   4. The `_security=https://www.icanbwell.com/access|<code>` search parameter
 *      (FilterBySecurityTag) reuses the same `_access.<code>` field as the authorization filter
 *      above.
 */
const { describe, test, expect, beforeEach, jest: jestGlobal } = require('@jest/globals');

jestGlobal.mock('../../../utils/assertType', () => ({
    assertIsValid: () => {},
    assertTypeEquals: () => {}
}));

jestGlobal.mock('../../../utils/querybuilder.util', () => ({
    tokenQueryBuilder: jestGlobal.fn().mockReturnValue({ tokenFallback: true })
}));

const { ScopesManager } = require('../../../operations/security/scopesManager');
const { SecurityTagManager } = require('../../../operations/common/securityTagManager');
const { FilterBySecurityTag } = require('../../../operations/query/filters/securityTag');
const { FieldMapper } = require('../../../operations/query/filters/fieldMapper');
const { SecurityTagSystem } = require('../../../utils/securityTagSystem');
const { tokenQueryBuilder } = require('../../../utils/querybuilder.util');

describe('Access tags (doc §1)', () => {
    describe('ScopesManager.getAccessCodesFromScopes — parses access/<tag>.<read|write|*> scopes', () => {
        /** @type {ScopesManager} */
        let scopesManager;

        beforeEach(() => {
            scopesManager = new ScopesManager({
                configManager: { authEnabled: true },
                patientFilterManager: {}
            });
        });

        test('extracts a single tag when the requested action matches exactly', () => {
            const codes = scopesManager.getAccessCodesFromScopes('read', 'user1', 'access/client-a.read');
            expect(codes).toEqual(['client-a']);
        });

        test('does not extract a tag when the requested action does not match and is not wildcarded', () => {
            const codes = scopesManager.getAccessCodesFromScopes('read', 'user1', 'access/client-a.write');
            expect(codes).toEqual([]);
        });

        test('a wildcard action (access/<tag>.*) authorizes both read and write requests', () => {
            const readCodes = scopesManager.getAccessCodesFromScopes('read', 'user1', 'access/client-a.*');
            const writeCodes = scopesManager.getAccessCodesFromScopes('write', 'user1', 'access/client-a.*');
            expect(readCodes).toEqual(['client-a']);
            expect(writeCodes).toEqual(['client-a']);
        });

        test('a scope string with multiple access/ entries yields multiple access codes (multi-tenant scope)', () => {
            const codes = scopesManager.getAccessCodesFromScopes(
                'read', 'user1', 'access/client-a.read access/client-b.read'
            );
            expect(codes.sort()).toEqual(['client-a', 'client-b']);
        });

        test('access/*.read parses to the literal wildcard access code', () => {
            const codes = scopesManager.getAccessCodesFromScopes('read', 'user1', 'access/*.read');
            expect(codes).toEqual(['*']);
        });

        test('non-access scopes (e.g. user/, patient/) contribute no access codes', () => {
            const codes = scopesManager.getAccessCodesFromScopes(
                'read', 'user1', 'user/Patient.read patient/Observation.read'
            );
            expect(codes).toEqual([]);
        });
    });

    describe('SecurityTagManager.getSecurityTagsFromScope — turns access codes into the tag list for the query filter', () => {
        /** @type {SecurityTagManager} */
        let securityTagManager;
        /** @type {ScopesManager} */
        let scopesManager;
        let mockAccessIndexManager;
        let mockPatientFilterManager;
        let mockR4SearchQueryCreator;

        beforeEach(() => {
            // Use the REAL ScopesManager so the access/<tag>.<action> parsing exercised above is
            // the same code path that feeds SecurityTagManager, not a re-stubbed substitute.
            scopesManager = new ScopesManager({
                configManager: { authEnabled: true },
                patientFilterManager: {}
            });
            mockAccessIndexManager = {
                resourceHasAccessIndexForAccessCodes: jestGlobal.fn().mockReturnValue(false)
            };
            mockPatientFilterManager = {};
            mockR4SearchQueryCreator = {
                appendAndSimplifyQuery: jestGlobal.fn(({ query, andQuery }) => {
                    if (Object.keys(query).length === 0) {
                        return andQuery;
                    }
                    return { $and: [query, andQuery] };
                })
            };
            securityTagManager = new SecurityTagManager({
                scopesManager,
                accessIndexManager: mockAccessIndexManager,
                patientFilterManager: mockPatientFilterManager,
                r4SearchQueryCreator: mockR4SearchQueryCreator
            });
        });

        test('a caller with one access/ scope gets that single code back as the tag filter list', () => {
            const tags = securityTagManager.getSecurityTagsFromScope({
                user: 'user1',
                scope: 'access/client-a.read',
                accessViaPatientScopes: false,
                accessRequested: 'read'
            });
            expect(tags).toEqual(['client-a']);
        });

        test('a caller with multiple access/ scopes gets all of them back (multi-tenant visibility list)', () => {
            const tags = securityTagManager.getSecurityTagsFromScope({
                user: 'user1',
                scope: 'access/client-a.read access/client-b.read',
                accessViaPatientScopes: false,
                accessRequested: 'read'
            });
            expect(tags.sort()).toEqual(['client-a', 'client-b']);
        });
    });

    describe('SecurityTagManager.getQueryWithSecurityTags — builds the Mongo filter ANDed onto the query', () => {
        /** @type {SecurityTagManager} */
        let securityTagManager;
        let mockScopesManager;
        let mockAccessIndexManager;
        let mockR4SearchQueryCreator;

        beforeEach(() => {
            mockScopesManager = { getAccessCodesFromScopes: jestGlobal.fn() };
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
                scopesManager: mockScopesManager,
                accessIndexManager: mockAccessIndexManager,
                patientFilterManager: {},
                r4SearchQueryCreator: mockR4SearchQueryCreator
            });
        });

        test('without an access index, filters on meta.security using $elemMatch against system=access', () => {
            const query = securityTagManager.getQueryWithSecurityTags({
                resourceType: 'Observation',
                securityTags: ['client-a'],
                query: {},
                useAccessIndex: false
            });

            expect(query).toEqual({
                'meta.security': {
                    $elemMatch: { system: SecurityTagSystem.access, code: 'client-a' }
                }
            });
        });

        test('multiple authorized tags use $in (membership/OR), not $all (intersection/AND) — shared visibility', () => {
            const query = securityTagManager.getQueryWithSecurityTags({
                resourceType: 'Observation',
                securityTags: ['myhealth', 'yourhealth'],
                query: {},
                useAccessIndex: false
            });

            // $in means "resource's meta.security array has at least one element whose code is
            // one of these" - a resource carrying BOTH tags (per the doc's example) matches this
            // filter for a caller authorized for only one of them. This is what "shared
            // visibility, not exclusive ownership" means at the query level.
            expect(query).toEqual({
                'meta.security': {
                    $elemMatch: {
                        system: SecurityTagSystem.access,
                        code: { $in: ['myhealth', 'yourhealth'] }
                    }
                }
            });
            expect(query['meta.security'].$elemMatch.code).not.toHaveProperty('$all');
        });

        test('useAccessIndex=true AND an access index exists → uses the denormalized _access.<code> field', () => {
            mockAccessIndexManager.resourceHasAccessIndexForAccessCodes.mockReturnValue(true);

            const query = securityTagManager.getQueryWithSecurityTags({
                resourceType: 'Patient',
                securityTags: ['client-a'],
                query: {},
                useAccessIndex: true
            });

            expect(query).toEqual({ '_access.client-a': 1 });
            expect(mockAccessIndexManager.resourceHasAccessIndexForAccessCodes).toHaveBeenCalledWith({
                resourceType: 'Patient',
                accessCodes: ['client-a']
            });
        });

        test('useAccessIndex=true but no access index for this collection → falls back to meta.security scan', () => {
            mockAccessIndexManager.resourceHasAccessIndexForAccessCodes.mockReturnValue(false);

            const query = securityTagManager.getQueryWithSecurityTags({
                resourceType: 'Observation',
                securityTags: ['client-a'],
                query: {},
                useAccessIndex: true
            });

            expect(query).toEqual({
                'meta.security': {
                    $elemMatch: { system: SecurityTagSystem.access, code: 'client-a' }
                }
            });
        });

        test('access index exists but useAccessIndex was not passed (defaults false) → still falls back to meta.security scan', () => {
            mockAccessIndexManager.resourceHasAccessIndexForAccessCodes.mockReturnValue(true);

            const query = securityTagManager.getQueryWithSecurityTags({
                resourceType: 'Patient',
                securityTags: ['client-a'],
                query: {}
            });

            expect(query).toEqual({
                'meta.security': {
                    $elemMatch: { system: SecurityTagSystem.access, code: 'client-a' }
                }
            });
            expect(mockAccessIndexManager.resourceHasAccessIndexForAccessCodes).not.toHaveBeenCalled();
        });

        test('multiple tags with an access index → $or of per-code _access.<code> lookups', () => {
            mockAccessIndexManager.resourceHasAccessIndexForAccessCodes.mockReturnValue(true);

            const query = securityTagManager.getQueryWithSecurityTags({
                resourceType: 'Patient',
                securityTags: ['myhealth', 'yourhealth'],
                query: {},
                useAccessIndex: true
            });

            expect(query).toEqual({
                $or: [
                    { '_access.myhealth': 1 },
                    { '_access.yourhealth': 1 }
                ]
            });
        });
    });

    describe('FilterBySecurityTag (_security=...access|<code> search parameter) reuses the same access-index field', () => {
        let mockFieldMapper;

        beforeEach(() => {
            tokenQueryBuilder.mockClear();
            mockFieldMapper = new FieldMapper({ useHistoryTable: false });
        });

        function createFilter (overrides = {}) {
            return new FilterBySecurityTag({
                propertyObj: overrides.propertyObj || {},
                parsedArg: overrides.parsedArg || { queryParameterValue: { value: 'test' } },
                fieldMapper: overrides.fieldMapper || mockFieldMapper,
                fnUseAccessIndex: overrides.fnUseAccessIndex || (() => false),
                resourceType: overrides.resourceType || 'Observation'
            });
        }

        test('searching _security=.../access|<code> produces the identical _access.<code>:1 shape SecurityTagManager uses for authorization', () => {
            const filter = createFilter({ fnUseAccessIndex: (code) => code === 'client-a' });

            const result = filter.filterByItem(
                'meta.security',
                `${SecurityTagSystem.access}|client-a`
            );

            // Same literal field pattern as SecurityTagManager.getQueryWithSecurityTags' access-index branch.
            expect(result).toEqual({ '_access.client-a': 1 });
        });

        test('searching by the owner system does NOT reuse the access-index field (only the access system does)', () => {
            const filter = createFilter({ fnUseAccessIndex: () => true });

            filter.filterByItem('meta.security', `${SecurityTagSystem.owner}|client-a`);

            expect(tokenQueryBuilder).toHaveBeenCalledWith(
                expect.objectContaining({ field: 'meta.security', type: 'code' })
            );
        });

        test('when fnUseAccessIndex denies the code, falls back to a meta.security token scan instead of the access-index field', () => {
            const filter = createFilter({ fnUseAccessIndex: () => false });

            const result = filter.filterByItem(
                'meta.security',
                `${SecurityTagSystem.access}|client-a`
            );

            expect(result).not.toEqual({ '_access.client-a': 1 });
            expect(tokenQueryBuilder).toHaveBeenCalled();
        });
    });
});
