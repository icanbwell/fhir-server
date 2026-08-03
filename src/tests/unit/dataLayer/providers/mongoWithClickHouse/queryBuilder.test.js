'use strict';

const { describe, test, expect } = require('@jest/globals');
const { QueryBuilder } = require('../../../../../dataLayer/providers/mongoWithClickHouse/queryBuilder');
const { TABLES, EVENT_TYPES } = require('../../../../../constants/clickHouseConstants');
const { TABLES, EVENT_TYPES } = require('../../../../../constants/clickHouseConstants');

describe('QueryBuilder', () => {
    describe('buildFindGroupsByMemberQuery', () => {
        test('returns query with HAVING clause for memberReferenceUuid', () => {
            const result = QueryBuilder.buildFindGroupsByMemberQuery({
                memberReferenceUuid: 'Patient/uuid-123',
                accessTags: [],
                ownerTags: [],
                limit: 10
            });

            expect(result.query).toContain(TABLES.GROUP_MEMBER_CURRENT_BY_ENTITY);
            expect(result.query).toContain('FINAL');
            expect(result.query).toContain(`argMaxMerge(event_type) = '${EVENT_TYPES.MEMBER_ADDED}'`);
            expect(result.query).toContain('argMaxMerge(inactive) = 0');
            expect(result.query).toContain('argMaxMerge(entity_reference_uuid) = {memberReferenceUuid:String}');
            expect(result.query_params.memberReferenceUuid).toBe('Patient/uuid-123');
            expect(result.query_params.limit).toBe(10);
        });

        test('returns query with HAVING clause for memberReferenceSourceId', () => {
            const result = QueryBuilder.buildFindGroupsByMemberQuery({
                memberReferenceSourceId: 'Patient/abc',
                accessTags: [],
                ownerTags: [],
                limit: 20
            });

            expect(result.query).toContain('argMaxMerge(entity_reference_source_id) = {memberReferenceSourceId:String}');
            expect(result.query_params.memberReferenceSourceId).toBe('Patient/abc');
        });

        test('includes afterGroupId seek cursor when provided', () => {
            const result = QueryBuilder.buildFindGroupsByMemberQuery({
                memberReferenceUuid: 'Patient/uuid-123',
                accessTags: [],
                ownerTags: [],
                limit: 10,
                afterGroupId: 'group-42'
            });

            expect(result.query).toContain('WHERE group_id > {afterGroupId:String}');
            expect(result.query_params.afterGroupId).toBe('group-42');
        });

        test('includes OFFSET when skip > 0 and no afterGroupId', () => {
            const result = QueryBuilder.buildFindGroupsByMemberQuery({
                memberReferenceUuid: 'Patient/uuid-123',
                accessTags: [],
                ownerTags: [],
                limit: 10,
                afterGroupId: null,
                skip: 50
            });

            expect(result.query).toContain('OFFSET {skip:UInt32}');
            expect(result.query_params.skip).toBe(50);
            expect(result.query).not.toContain('afterGroupId');
        });

        test('uses basic query (no offset, no cursor) when skip=0 and no afterGroupId', () => {
            const result = QueryBuilder.buildFindGroupsByMemberQuery({
                memberReferenceUuid: 'Patient/uuid-123',
                accessTags: [],
                ownerTags: [],
                limit: 5,
                afterGroupId: null,
                skip: 0
            });

            expect(result.query).not.toContain('OFFSET');
            expect(result.query).not.toContain('afterGroupId');
            expect(result.query).toContain('LIMIT {limit:UInt32}');
        });

        test('includes accessTags in HAVING clause and query_params', () => {
            const result = QueryBuilder.buildFindGroupsByMemberQuery({
                memberReferenceUuid: 'Patient/uuid-123',
                accessTags: ['tag1', 'tag2'],
                ownerTags: [],
                limit: 10
            });

            expect(result.query).toContain('hasAny(argMaxMerge(access_tags), {accessTags:Array(String)})');
            expect(result.query_params.accessTags).toEqual(['tag1', 'tag2']);
        });

        test('includes ownerTags in HAVING clause and query_params', () => {
            const result = QueryBuilder.buildFindGroupsByMemberQuery({
                memberReferenceUuid: 'Patient/uuid-123',
                accessTags: [],
                ownerTags: ['owner1'],
                limit: 10
            });

            expect(result.query).toContain('hasAny(argMaxMerge(owner_tags), {ownerTags:Array(String)})');
            expect(result.query_params.ownerTags).toEqual(['owner1']);
        });

        test('does not include accessTags/ownerTags in params when arrays are empty', () => {
            const result = QueryBuilder.buildFindGroupsByMemberQuery({
                memberReferenceUuid: 'Patient/uuid-123',
                accessTags: [],
                ownerTags: [],
                limit: 10
            });

            expect(result.query_params.accessTags).toBeUndefined();
            expect(result.query_params.ownerTags).toBeUndefined();
        });

        test('sets memberReferenceUuid to empty string when not provided', () => {
            const result = QueryBuilder.buildFindGroupsByMemberQuery({
                memberReferenceSourceId: 'Patient/src-1',
                accessTags: [],
                ownerTags: [],
                limit: 10
            });

            expect(result.query_params.memberReferenceUuid).toBe('');
        });

        test('sets memberReferenceSourceId to empty string when not provided', () => {
            const result = QueryBuilder.buildFindGroupsByMemberQuery({
                memberReferenceUuid: 'Patient/uuid-1',
                accessTags: [],
                ownerTags: [],
                limit: 10
            });

            expect(result.query_params.memberReferenceSourceId).toBe('');
        });

        test('prefers afterGroupId over skip when both provided', () => {
            const result = QueryBuilder.buildFindGroupsByMemberQuery({
                memberReferenceUuid: 'Patient/uuid-1',
                accessTags: [],
                ownerTags: [],
                limit: 10,
                afterGroupId: 'grp-99',
                skip: 100
            });

            expect(result.query).toContain('afterGroupId');
            expect(result.query).not.toContain('OFFSET');
        });

        test('groups by group_id and entity_reference', () => {
            const result = QueryBuilder.buildFindGroupsByMemberQuery({
                memberReferenceUuid: 'Patient/uuid-1',
                accessTags: [],
                ownerTags: [],
                limit: 10
            });

            expect(result.query).toContain('GROUP BY group_id, entity_reference');
        });

        test('orders results by group_id', () => {
            const result = QueryBuilder.buildFindGroupsByMemberQuery({
                memberReferenceUuid: 'Patient/uuid-1',
                accessTags: [],
                ownerTags: [],
                limit: 10
            });

            expect(result.query).toContain('ORDER BY group_id');
        });
    });

    describe('buildCountGroupsByMemberQuery', () => {
        test('returns count query wrapping the grouped subquery', () => {
            const result = QueryBuilder.buildCountGroupsByMemberQuery({
                memberReferenceUuid: 'Patient/uuid-1',
                accessTags: [],
                ownerTags: []
            });

            expect(result.query).toContain('SELECT count() as total');
            expect(result.query).toContain(TABLES.GROUP_MEMBER_CURRENT_BY_ENTITY);
            expect(result.query).toContain('FINAL');
        });

        test('includes member reference filtering in HAVING', () => {
            const result = QueryBuilder.buildCountGroupsByMemberQuery({
                memberReferenceUuid: 'Patient/uuid-1',
                memberReferenceSourceId: 'Patient/src-1',
                accessTags: [],
                ownerTags: []
            });

            expect(result.query).toContain('argMaxMerge(entity_reference_uuid) = {memberReferenceUuid:String}');
            expect(result.query).toContain('argMaxMerge(entity_reference_source_id) = {memberReferenceSourceId:String}');
        });

        test('includes security tags when provided', () => {
            const result = QueryBuilder.buildCountGroupsByMemberQuery({
                memberReferenceUuid: 'Patient/uuid-1',
                accessTags: ['access1'],
                ownerTags: ['owner1']
            });

            expect(result.query).toContain('hasAny(argMaxMerge(access_tags), {accessTags:Array(String)})');
            expect(result.query).toContain('hasAny(argMaxMerge(owner_tags), {ownerTags:Array(String)})');
            expect(result.query_params.accessTags).toEqual(['access1']);
            expect(result.query_params.ownerTags).toEqual(['owner1']);
        });

        test('does not include limit or offset', () => {
            const result = QueryBuilder.buildCountGroupsByMemberQuery({
                memberReferenceUuid: 'Patient/uuid-1',
                accessTags: [],
                ownerTags: []
            });

            expect(result.query).not.toContain('LIMIT');
            expect(result.query).not.toContain('OFFSET');
        });
    });

    describe('buildActiveMembers', () => {
        test('returns query for active members of a group', () => {
            const result = QueryBuilder.buildActiveMembers({
                groupId: 'grp-1',
                limit: 50
            });

            expect(result.query).toContain(TABLES.GROUP_MEMBER_CURRENT);
            expect(result.query).toContain('FINAL');
            expect(result.query).toContain(`event_type = '${EVENT_TYPES.MEMBER_ADDED}'`);
            expect(result.query).toContain('inactive = 0');
            expect(result.query).toContain('WHERE group_id = {groupId:String}');
            expect(result.query_params.groupId).toBe('grp-1');
            expect(result.query_params.limit).toBe(50);
        });

        test('includes cursor clause when afterReference provided', () => {
            const result = QueryBuilder.buildActiveMembers({
                groupId: 'grp-1',
                limit: 50,
                afterReference: 'Patient/ref-99'
            });

            expect(result.query).toContain('AND entity_reference > {afterReference:String}');
            expect(result.query_params.afterReference).toBe('Patient/ref-99');
        });

        test('omits cursor clause when afterReference is null', () => {
            const result = QueryBuilder.buildActiveMembers({
                groupId: 'grp-1',
                limit: 50,
                afterReference: null
            });

            expect(result.query).not.toContain('afterReference');
            expect(result.query_params.afterReference).toBeUndefined();
        });

        test('selects entity_reference, entity_type, and inactive', () => {
            const result = QueryBuilder.buildActiveMembers({
                groupId: 'grp-1',
                limit: 10
            });

            expect(result.query).toContain('entity_reference');
            expect(result.query).toContain('entity_type');
            expect(result.query).toContain('inactive');
        });

        test('orders by entity_reference', () => {
            const result = QueryBuilder.buildActiveMembers({
                groupId: 'grp-1',
                limit: 10
            });

            expect(result.query).toContain('ORDER BY entity_reference');
        });

        test('uses argMaxMerge for aggregate function columns', () => {
            const result = QueryBuilder.buildActiveMembers({
                groupId: 'grp-1',
                limit: 10
            });

            expect(result.query).toContain('argMaxMerge(entity_type) AS entity_type');
            expect(result.query).toContain('argMaxMerge(event_type)  AS event_type');
            expect(result.query).toContain('argMaxMerge(inactive)    AS inactive');
        });
    });

    describe('buildActiveMemberCount', () => {
        test('returns count query for active members of a group', () => {
            const result = QueryBuilder.buildActiveMemberCount({ groupId: 'grp-1' });

            expect(result.query).toContain('SELECT count() as count');
            expect(result.query).toContain(TABLES.GROUP_MEMBER_CURRENT);
            expect(result.query).toContain('FINAL');
            expect(result.query).toContain('WHERE group_id = {groupId:String}');
            expect(result.query_params).toEqual({ groupId: 'grp-1' });
        });

        test('uses HAVING clause for active member filtering', () => {
            const result = QueryBuilder.buildActiveMemberCount({ groupId: 'grp-1' });

            expect(result.query).toContain(`argMaxMerge(event_type) = '${EVENT_TYPES.MEMBER_ADDED}'`);
            expect(result.query).toContain('argMaxMerge(inactive) = 0');
        });

        test('groups by entity_reference', () => {
            const result = QueryBuilder.buildActiveMemberCount({ groupId: 'grp-1' });

            expect(result.query).toContain('GROUP BY entity_reference');
        });
    });

    describe('_buildActiveMemberHavingClause (private, tested through public methods)', () => {
        test('always includes event_type and inactive clauses', () => {
            const result = QueryBuilder.buildFindGroupsByMemberQuery({
                accessTags: [],
                ownerTags: [],
                limit: 10
            });

            expect(result.query).toContain(`argMaxMerge(event_type) = '${EVENT_TYPES.MEMBER_ADDED}'`);
            expect(result.query).toContain('argMaxMerge(inactive) = 0');
        });

        test('combines all clauses with AND', () => {
            const result = QueryBuilder.buildFindGroupsByMemberQuery({
                memberReferenceUuid: 'Patient/uuid-1',
                memberReferenceSourceId: 'Patient/src-1',
                accessTags: ['a'],
                ownerTags: ['o'],
                limit: 10
            });

            // All four conditions + base 2 = 6 ANDs (5 AND separators)
            const havingMatch = result.query.match(/HAVING\s+(.*)/s);
            expect(havingMatch).toBeTruthy();
            const havingClause = havingMatch[1];
            expect(havingClause).toContain(' AND ');
        });

        test('omits entity_reference_uuid clause when not provided', () => {
            const result = QueryBuilder.buildFindGroupsByMemberQuery({
                memberReferenceSourceId: 'Patient/src-1',
                accessTags: [],
                ownerTags: [],
                limit: 10
            });

            expect(result.query).not.toContain('entity_reference_uuid');
        });

        test('omits entity_reference_source_id clause when not provided', () => {
            const result = QueryBuilder.buildFindGroupsByMemberQuery({
                memberReferenceUuid: 'Patient/uuid-1',
                accessTags: [],
                ownerTags: [],
                limit: 10
            });

            expect(result.query).not.toContain('entity_reference_source_id');
        });
    });
});


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
