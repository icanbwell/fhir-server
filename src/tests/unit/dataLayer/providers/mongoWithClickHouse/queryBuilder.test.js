const { describe, test, expect } = require('@jest/globals');
const { QueryBuilder } = require('../../../../../dataLayer/providers/mongoWithClickHouse/queryBuilder');

describe('QueryBuilder.buildActiveMembers', () => {
    test('adds access tag predicate and param when accessTags present', () => {
        const { query, query_params } = QueryBuilder.buildActiveMembers({
            groupId: 'group-1',
            limit: 100,
            accessTags: ['clientA']
        });

        expect(query).toContain('argMaxMerge(access_tags) AS access_tags');
        expect(query).toContain('hasAny(access_tags, {accessTags:Array(String)})');
        expect(query_params.accessTags).toEqual(['clientA']);
    });

    test('adds owner tag predicate and param when ownerTags present', () => {
        const { query, query_params } = QueryBuilder.buildActiveMembers({
            groupId: 'group-1',
            limit: 100,
            ownerTags: ['bwell']
        });

        expect(query).toContain('argMaxMerge(owner_tags)  AS owner_tags');
        expect(query).toContain('hasAny(owner_tags, {ownerTags:Array(String)})');
        expect(query_params.ownerTags).toEqual(['bwell']);
    });

    test('omits tag predicates and params when no tags provided', () => {
        const { query, query_params } = QueryBuilder.buildActiveMembers({
            groupId: 'group-1',
            limit: 100
        });

        expect(query).not.toContain('hasAny(access_tags');
        expect(query).not.toContain('hasAny(owner_tags');
        expect(query_params.accessTags).toBeUndefined();
        expect(query_params.ownerTags).toBeUndefined();
    });
});

describe('QueryBuilder.buildActiveMemberCount', () => {
    test('adds access tag clause to HAVING and param when accessTags present', () => {
        const { query, query_params } = QueryBuilder.buildActiveMemberCount({
            groupId: 'group-1',
            accessTags: ['clientA']
        });

        expect(query).toContain('hasAny(argMaxMerge(access_tags), {accessTags:Array(String)})');
        expect(query_params.accessTags).toEqual(['clientA']);
    });

    test('adds owner tag clause to HAVING and param when ownerTags present', () => {
        const { query, query_params } = QueryBuilder.buildActiveMemberCount({
            groupId: 'group-1',
            ownerTags: ['bwell']
        });

        expect(query).toContain('hasAny(argMaxMerge(owner_tags), {ownerTags:Array(String)})');
        expect(query_params.ownerTags).toEqual(['bwell']);
    });

    test('omits tag clauses and params when no tags provided', () => {
        const { query, query_params } = QueryBuilder.buildActiveMemberCount({
            groupId: 'group-1'
        });

        expect(query).not.toContain('hasAny(argMaxMerge(access_tags)');
        expect(query).not.toContain('hasAny(argMaxMerge(owner_tags)');
        expect(query_params.accessTags).toBeUndefined();
        expect(query_params.ownerTags).toBeUndefined();
    });
});
