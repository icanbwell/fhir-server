// Test for group_id + member combined filtering in ClickHouse
// Verifies that _id parameter is properly passed to ClickHouse WHERE clause

const { describe, test, beforeAll, afterAll, beforeEach, expect } = require('@jest/globals');
const {
    setupGroupTests,
    teardownGroupTests,
    cleanupAllData,
    getSharedRequest,
    getTestHeadersWithExternalStorage,
    syncClickHouseMaterializedViews,
    waitForData
} = require('./groupTestSetup');
const { QueryParser } = require('../../dataLayer/providers/mongoWithClickHouse/queryParser');
const { QueryBuilder } = require('../../dataLayer/providers/mongoWithClickHouse/queryBuilder');
const { FilterById } = require('../../operations/query/filters/id');

describe('Group ID with Member Filter Tests', () => {
    beforeAll(async () => {
        await setupGroupTests();
    });

    afterAll(async () => {
        await teardownGroupTests();
    });

    beforeEach(async () => {
        await cleanupAllData();
    });

    describe('QueryParser.extractGroupIdFilter', () => {
        test('extracts single group ID from _sourceId field (non-UUID)', () => {
            // Real query structure from FilterById for non-UUID IDs
            const query = { _sourceId: { $in: ['test-group-1'] } };
            const result = QueryParser.extractGroupIdFilter(query);
            expect(result).toEqual(['test-group-1']);
        });

        test('extracts single group ID from _uuid field (UUID)', () => {
            // Real query structure from FilterById for UUID IDs
            const uuidValue = '550e8400-e29b-41d4-a716-446655440000';
            const query = { _uuid: { $in: [uuidValue] } };
            const result = QueryParser.extractGroupIdFilter(query);
            expect(result).toEqual([uuidValue]);
        });

        test('extracts multiple group IDs from $in operator', () => {
            const query = { _sourceId: { $in: ['group-1', 'group-2', 'group-3'] } };
            const result = QueryParser.extractGroupIdFilter(query);
            expect(result).toEqual(['group-1', 'group-2', 'group-3']);
        });

        test('extracts group ID from $eq operator', () => {
            const query = { _sourceId: { $eq: 'test-group' } };
            const result = QueryParser.extractGroupIdFilter(query);
            expect(result).toEqual(['test-group']);
        });

        test('extracts group ID from nested $or (real FilterById structure)', () => {
            // Real query structure from FilterById.getListFilter(['test-group'])
            const query = {
                $or: [
                    { _sourceId: { $in: ['test-group'] } }
                ]
            };
            const result = QueryParser.extractGroupIdFilter(query);
            expect(result).toEqual(['test-group']);
        });

        test('extracts mixed UUID and non-UUID IDs from $or', () => {
            // Real query structure when both UUID and non-UUID IDs are provided
            const uuidValue = '550e8400-e29b-41d4-a716-446655440000';
            const query = {
                $or: [
                    { _uuid: { $in: [uuidValue] } },
                    { _sourceId: { $in: ['non-uuid-group'] } }
                ]
            };
            const result = QueryParser.extractGroupIdFilter(query);
            expect(result).toEqual([uuidValue, 'non-uuid-group']);
        });

        test('extracts from nested $and with $or (realistic search query)', () => {
            // Simulates GET /Group?_id=test-group&member=Patient/123
            const query = {
                $and: [
                    {
                        $or: [
                            { _sourceId: { $in: ['test-group'] } }
                        ]
                    },
                    { 'member.entity._uuid': 'Patient/123' }
                ]
            };
            const result = QueryParser.extractGroupIdFilter(query);
            expect(result).toEqual(['test-group']);
        });

        test('uses FilterById.getListFilter to generate real query', () => {
            // Test with actual FilterById output
            const query = FilterById.getListFilter(['test-group-1', 'test-group-2']);
            const result = QueryParser.extractGroupIdFilter(query);
            expect(result).toEqual(['test-group-1', 'test-group-2']);
        });

        test('returns empty array when no id fields present', () => {
            const query = { 'member.entity._uuid': 'Patient/123' };
            const result = QueryParser.extractGroupIdFilter(query);
            expect(result).toEqual([]);
        });

        test('deduplicates group IDs', () => {
            const query = {
                $and: [
                    { _sourceId: { $in: ['test-group'] } },
                    { _sourceId: { $in: ['test-group'] } }
                ]
            };
            const result = QueryParser.extractGroupIdFilter(query);
            expect(result).toEqual(['test-group']);
        });
    });

    describe('QueryBuilder.buildFindGroupsByMemberQuery with groupIds', () => {
        test('includes WHERE clause when groupIds provided', () => {
            const { query, query_params } = QueryBuilder.buildFindGroupsByMemberQuery({
                groupIds: ['test-group-1', 'test-group-2'],
                memberReferenceUuid: 'Patient/123',
                accessTags: [],
                ownerTags: [],
                limit: 100
            });

            // Should include WHERE group_id IN clause
            expect(query).toContain('WHERE group_id IN {groupIds:Array(String)}');
            expect(query_params.groupIds).toEqual(['test-group-1', 'test-group-2']);
        });

        test('excludes WHERE clause when groupIds empty', () => {
            const { query, query_params } = QueryBuilder.buildFindGroupsByMemberQuery({
                groupIds: [],
                memberReferenceUuid: 'Patient/123',
                accessTags: [],
                ownerTags: [],
                limit: 100
            });

            // Should NOT include WHERE clause
            expect(query).not.toContain('WHERE');
            expect(query_params.groupIds).toBeUndefined();
        });

        test('combines groupIds with afterGroupId cursor', () => {
            const { query, query_params } = QueryBuilder.buildFindGroupsByMemberQuery({
                groupIds: ['test-group'],
                memberReferenceUuid: 'Patient/123',
                accessTags: [],
                ownerTags: [],
                limit: 100,
                afterGroupId: 'cursor-group-id'
            });

            // Should combine both in WHERE clause
            expect(query).toContain('WHERE group_id IN {groupIds:Array(String)} AND group_id > {afterGroupId:String}');
            expect(query_params.groupIds).toEqual(['test-group']);
            expect(query_params.afterGroupId).toBe('cursor-group-id');
        });
    });

    describe('QueryBuilder.buildCountGroupsByMemberQuery with groupIds', () => {
        test('includes WHERE clause when groupIds provided', () => {
            const { query, query_params } = QueryBuilder.buildCountGroupsByMemberQuery({
                groupIds: ['test-group'],
                memberReferenceUuid: 'Patient/123',
                accessTags: [],
                ownerTags: []
            });

            expect(query).toContain('WHERE group_id IN {groupIds:Array(String)}');
            expect(query_params.groupIds).toEqual(['test-group']);
        });

        test('excludes WHERE clause when groupIds empty', () => {
            const { query } = QueryBuilder.buildCountGroupsByMemberQuery({
                groupIds: [],
                memberReferenceUuid: 'Patient/123',
                accessTags: [],
                ownerTags: []
            });

            expect(query).not.toContain('WHERE');
        });
    });

    describe('Integration: Group ID + Member query', () => {
        test('filters by both group_id and member in ClickHouse', async () => {
            const request = getSharedRequest();

            // Create test Group with member
            const groupResource = {
                resourceType: 'Group',
                id: 'DBT5-Denominator-samsung',
                type: 'person',
                actual: true,
                member: [
                    {
                        entity: {
                            reference: 'Patient/test-patient-123'
                        }
                    }
                ]
            };

            // Create another Group with same member (to test filtering works)
            const otherGroupResource = {
                resourceType: 'Group',
                id: 'other-group',
                type: 'person',
                actual: true,
                member: [
                    {
                        entity: {
                            reference: 'Patient/test-patient-123'
                        }
                    }
                ]
            };

            // POST both groups with useExternalStorage header
            let resp = await request
                .post('/4_0_0/Group')
                .send(groupResource)
                .set(getTestHeadersWithExternalStorage())
                .expect(201);

            resp = await request
                .post('/4_0_0/Group')
                .send(otherGroupResource)
                .set(getTestHeadersWithExternalStorage())
                .expect(201);

            // Wait for ClickHouse data
            await syncClickHouseMaterializedViews();
            await waitForData(
                async () => {
                    const resp = await request
                        .get('/4_0_0/Group?member=Patient/test-patient-123')
                        .set(getTestHeadersWithExternalStorage());
                    return resp.body?.entry?.length >= 2;
                },
                { description: 'both groups with member to be available' }
            );

            // Query with BOTH _id and member parameters
            resp = await request
                .get('/4_0_0/Group?_id=DBT5-Denominator-samsung&member=Patient/test-patient-123')
                .set(getTestHeadersWithExternalStorage())
                .expect(200);

            const bundle = resp.body;
            expect(bundle.resourceType).toBe('Bundle');
            expect(bundle.total).toBe(1);
            expect(bundle.entry).toHaveLength(1);
            expect(bundle.entry[0].resource.id).toBe('DBT5-Denominator-samsung');
        });

        test('returns empty when group_id does not match but member does', async () => {
            const request = getSharedRequest();

            const groupResource = {
                resourceType: 'Group',
                id: 'existing-group',
                type: 'person',
                actual: true,
                member: [
                    {
                        entity: {
                            reference: 'Patient/test-patient-456'
                        }
                    }
                ]
            };

            let resp = await request
                .post('/4_0_0/Group')
                .send(groupResource)
                .set(getTestHeadersWithExternalStorage())
                .expect(201);

            // Wait for ClickHouse data
            await syncClickHouseMaterializedViews();
            await waitForData(
                async () => {
                    const resp = await request
                        .get('/4_0_0/Group?member=Patient/test-patient-456')
                        .set(getTestHeadersWithExternalStorage());
                    return resp.body?.entry?.length >= 1;
                },
                { description: 'group with member to be available' }
            );

            // Query with _id that doesn't exist but member that does
            resp = await request
                .get('/4_0_0/Group?_id=non-existent-group&member=Patient/test-patient-456')
                .set(getTestHeadersWithExternalStorage())
                .expect(200);

            const bundle = resp.body;
            expect(bundle.total).toBe(0);
            expect(bundle.entry).toBeUndefined();
        });
    });
});
