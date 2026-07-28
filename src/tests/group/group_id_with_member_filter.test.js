// Test for group_id + member combined filtering in ClickHouse
// Verifies that _id parameter is properly passed to ClickHouse WHERE clause

const { commonBeforeEach, commonAfterEach, createTestRequest, getTestContainer } = require('../common');
const { QueryParser } = require('../../dataLayer/providers/mongoWithClickHouse/queryParser');
const { QueryBuilder } = require('../../dataLayer/providers/mongoWithClickHouse/queryBuilder');

describe('Group ID with Member Filter Tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('QueryParser.extractGroupIdFilter', () => {
        test('extracts single group ID from id field', () => {
            const query = { id: 'test-group-1' };
            const result = QueryParser.extractGroupIdFilter(query);
            expect(result).toEqual(['test-group-1']);
        });

        test('extracts single group ID from _id field', () => {
            const query = { _id: 'test-group-1' };
            const result = QueryParser.extractGroupIdFilter(query);
            expect(result).toEqual(['test-group-1']);
        });

        test('extracts multiple group IDs from $in operator', () => {
            const query = { id: { $in: ['group-1', 'group-2', 'group-3'] } };
            const result = QueryParser.extractGroupIdFilter(query);
            expect(result).toEqual(['group-1', 'group-2', 'group-3']);
        });

        test('extracts group ID from $eq operator', () => {
            const query = { id: { $eq: 'test-group' } };
            const result = QueryParser.extractGroupIdFilter(query);
            expect(result).toEqual(['test-group']);
        });

        test('extracts group ID from nested $and', () => {
            const query = {
                $and: [
                    { id: 'test-group' },
                    { 'member.entity._uuid': 'Patient/123' }
                ]
            };
            const result = QueryParser.extractGroupIdFilter(query);
            expect(result).toEqual(['test-group']);
        });

        test('returns empty array when no id fields present', () => {
            const query = { 'member.entity._uuid': 'Patient/123' };
            const result = QueryParser.extractGroupIdFilter(query);
            expect(result).toEqual([]);
        });

        test('deduplicates group IDs', () => {
            const query = {
                $and: [
                    { id: 'test-group' },
                    { _id: 'test-group' }
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
            const container = getTestContainer();

            // Create test Group with member
            const request = await createTestRequest();
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
                .post('/4_0_0/Group/1/$merge?validate=true')
                .send(groupResource)
                .set('Content-Type', 'application/fhir+json')
                .set('useExternalStorage', 'true')
                .expect(200);

            resp = await request
                .post('/4_0_0/Group/1/$merge?validate=true')
                .send(otherGroupResource)
                .set('Content-Type', 'application/fhir+json')
                .set('useExternalStorage', 'true')
                .expect(200);

            // Query with BOTH _id and member parameters
            resp = await request
                .get('/4_0_0/Group?_id=DBT5-Denominator-samsung&member=Patient/test-patient-123')
                .set('useExternalStorage', 'true')
                .expect(200);

            const bundle = resp.body;
            expect(bundle.resourceType).toBe('Bundle');
            expect(bundle.total).toBe(1);
            expect(bundle.entry).toHaveLength(1);
            expect(bundle.entry[0].resource.id).toBe('DBT5-Denominator-samsung');
        });

        test('returns empty when group_id does not match but member does', async () => {
            const container = getTestContainer();

            const request = await createTestRequest();
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
                .post('/4_0_0/Group/1/$merge?validate=true')
                .send(groupResource)
                .set('Content-Type', 'application/fhir+json')
                .set('useExternalStorage', 'true')
                .expect(200);

            // Query with _id that doesn't exist but member that does
            resp = await request
                .get('/4_0_0/Group?_id=non-existent-group&member=Patient/test-patient-456')
                .set('useExternalStorage', 'true')
                .expect(200);

            const bundle = resp.body;
            expect(bundle.total).toBe(0);
            expect(bundle.entry).toBeUndefined();
        });
    });
});
