const { describe, test, expect } = require('@jest/globals');
const { QueryBuilder } = require('../../../../../dataLayer/providers/mongoWithClickHouse/queryBuilder');

// Note: ServerError (the base of ForbiddenError) resets its prototype to
// ServerError in its constructor, so `instanceof ForbiddenError` is unreliable
// codebase-wide. We assert on the HTTP-meaningful statusCode (403) instead.
const expectForbidden = (fn) => {
    let thrown;
    try {
        fn();
    } catch (e) {
        thrown = e;
    }
    expect(thrown).toBeDefined();
    expect(thrown.statusCode).toBe(403);
};

/**
 * B3 - Tenant isolation on the ClickHouse Group reverse-lookup (fail-closed,
 * admin-exempt), mirroring SecurityTagManager / ScopesManager.
 *
 * Authorization is decided upstream, not inferred here from tag presence:
 *   - Full/wildcard access (access/*.*) => hasFullAccess=true => NO tenant
 *     predicate (the admin legitimately sees every tenant). A wildcard admin
 *     resolves to EMPTY security tags upstream, so tag-based inference would
 *     wrongly deny them.
 *   - Scoped caller => non-empty access/owner tags => tag filter applied.
 *   - Genuinely unscoped non-admin (no tags AND not full access) => denied with
 *     a 403 ForbiddenError, matching the write path (QueryFragments throws on
 *     empty tags). Such callers are already 403'd upstream; this is defense in
 *     depth.
 */
describe('QueryBuilder tenant isolation (B3)', () => {
    const baseArgs = {
        memberReferenceUuid: 'Patient/uuid-1',
        memberReferenceSourceId: undefined,
        limit: 100
    };

    describe('buildFindGroupsByMemberQuery', () => {
        test('denies with 403 when both tag arrays are empty and not full access', () => {
            expectForbidden(() => QueryBuilder.buildFindGroupsByMemberQuery({
                ...baseArgs,
                accessTags: [],
                ownerTags: []
            }));
        });

        test('denies with 403 when tags are omitted entirely (defaults)', () => {
            expectForbidden(() => QueryBuilder.buildFindGroupsByMemberQuery({ ...baseArgs }));
        });

        test('does NOT deny and omits tenant predicate for a full-access caller', () => {
            const { query, query_params } = QueryBuilder.buildFindGroupsByMemberQuery({
                ...baseArgs,
                accessTags: [],
                ownerTags: [],
                hasFullAccess: true
            });
            // Full access => no tenant predicate at all
            expect(query).not.toContain('1 = 0');
            expect(query).not.toContain('access_tags');
            expect(query).not.toContain('owner_tags');
            expect(query_params.accessTags).toBeUndefined();
            expect(query_params.ownerTags).toBeUndefined();
            // Still an active-member query
            expect(query).toContain("argMaxMerge(event_type) = 'added'");
        });

        test('applies the access tag filter for a scoped caller', () => {
            const { query, query_params } = QueryBuilder.buildFindGroupsByMemberQuery({
                ...baseArgs,
                accessTags: ['client1'],
                ownerTags: []
            });
            expect(query).not.toContain('1 = 0');
            expect(query).toContain('hasAny(argMaxMerge(access_tags)');
            expect(query_params.accessTags).toEqual(['client1']);
        });

        test('applies the owner tag filter for a scoped caller', () => {
            const { query } = QueryBuilder.buildFindGroupsByMemberQuery({
                ...baseArgs,
                accessTags: [],
                ownerTags: ['bwell']
            });
            expect(query).not.toContain('1 = 0');
            expect(query).toContain('hasAny(argMaxMerge(owner_tags)');
        });

        test('full access takes precedence: predicate omitted even if tags were present', () => {
            const { query } = QueryBuilder.buildFindGroupsByMemberQuery({
                ...baseArgs,
                accessTags: ['client1'],
                ownerTags: [],
                hasFullAccess: true
            });
            // hasFullAccess short-circuits before any tag filter is added
            expect(query).not.toContain('hasAny(argMaxMerge(access_tags)');
        });
    });

    describe('buildCountGroupsByMemberQuery', () => {
        test('denies with 403 when both tag arrays are empty and not full access', () => {
            expectForbidden(() => QueryBuilder.buildCountGroupsByMemberQuery({
                memberReferenceUuid: 'Patient/uuid-1',
                accessTags: [],
                ownerTags: []
            }));
        });

        test('omits tenant predicate for a full-access caller', () => {
            const { query } = QueryBuilder.buildCountGroupsByMemberQuery({
                memberReferenceUuid: 'Patient/uuid-1',
                accessTags: [],
                ownerTags: [],
                hasFullAccess: true
            });
            expect(query).not.toContain('1 = 0');
            expect(query).not.toContain('access_tags');
        });

        test('applies the tag filter for a scoped caller', () => {
            const { query } = QueryBuilder.buildCountGroupsByMemberQuery({
                memberReferenceUuid: 'Patient/uuid-1',
                accessTags: ['client1'],
                ownerTags: []
            });
            expect(query).not.toContain('1 = 0');
            expect(query).toContain('hasAny(argMaxMerge(access_tags)');
        });
    });
});
