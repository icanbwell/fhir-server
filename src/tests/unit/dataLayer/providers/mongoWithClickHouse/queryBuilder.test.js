const { describe, test, expect } = require('@jest/globals');
const { QueryBuilder } = require('../../../../../dataLayer/providers/mongoWithClickHouse/queryBuilder');

/**
 * B3 - Fail-closed tenant isolation on the ClickHouse read path.
 *
 * An empty-tag query must NOT return cross-tenant rows. The read path now
 * injects a deny clause ("1 = 0") when both access and owner tags are absent,
 * matching the write path (which throws on empty tags). A legitimately scoped
 * admin caller carries a wildcard code (e.g. ['*']) which arrives as a
 * non-empty array and is therefore not blocked.
 */
describe('QueryBuilder tenant isolation (B3)', () => {
    const baseArgs = {
        memberReferenceUuid: 'Patient/uuid-1',
        memberReferenceSourceId: undefined,
        limit: 100
    };

    describe('buildFindGroupsByMemberQuery', () => {
        test('injects deny clause when both tag arrays are empty (fail closed)', () => {
            const { query } = QueryBuilder.buildFindGroupsByMemberQuery({
                ...baseArgs,
                accessTags: [],
                ownerTags: []
            });
            expect(query).toContain('1 = 0');
            // Must not attempt to bind tag params it does not have
            expect(query).not.toContain('access_tags');
            expect(query).not.toContain('owner_tags');
        });

        test('injects deny clause when tags are omitted entirely (defaults)', () => {
            const { query } = QueryBuilder.buildFindGroupsByMemberQuery({ ...baseArgs });
            expect(query).toContain('1 = 0');
        });

        test('does NOT deny when access tags are present', () => {
            const { query, query_params } = QueryBuilder.buildFindGroupsByMemberQuery({
                ...baseArgs,
                accessTags: ['client1'],
                ownerTags: []
            });
            expect(query).not.toContain('1 = 0');
            expect(query).toContain('hasAny(argMaxMerge(access_tags)');
            expect(query_params.accessTags).toEqual(['client1']);
        });

        test('does NOT deny when owner tags are present', () => {
            const { query } = QueryBuilder.buildFindGroupsByMemberQuery({
                ...baseArgs,
                accessTags: [],
                ownerTags: ['bwell']
            });
            expect(query).not.toContain('1 = 0');
            expect(query).toContain('hasAny(argMaxMerge(owner_tags)');
        });

        test('preserves the legitimate wildcard admin scope (non-empty array)', () => {
            const { query, query_params } = QueryBuilder.buildFindGroupsByMemberQuery({
                ...baseArgs,
                accessTags: ['*'],
                ownerTags: []
            });
            // Wildcard is a real, non-empty tag => not fail-closed
            expect(query).not.toContain('1 = 0');
            expect(query).toContain('hasAny(argMaxMerge(access_tags)');
            expect(query_params.accessTags).toEqual(['*']);
        });
    });

    describe('buildCountGroupsByMemberQuery', () => {
        test('injects deny clause when both tag arrays are empty (fail closed)', () => {
            const { query } = QueryBuilder.buildCountGroupsByMemberQuery({
                memberReferenceUuid: 'Patient/uuid-1',
                accessTags: [],
                ownerTags: []
            });
            expect(query).toContain('1 = 0');
        });

        test('does NOT deny when tags are present', () => {
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
