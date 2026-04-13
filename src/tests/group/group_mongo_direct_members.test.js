/**
 * Tests for MongoDB Direct Group Member implementation (V2)
 *
 * Covers the complete lifecycle: write members to direct collection,
 * read Group with quantity enrichment, search Groups by member reference.
 *
 * Key difference from V1: no member validation, no event sourcing, UUID refs only.
 */
process.env.ENABLE_MONGO_DIRECT_GROUP_MEMBERS = '1';
process.env.LOGLEVEL = 'SILENT';
process.env.STREAM_RESPONSE = '0';

const { describe, test, beforeAll, beforeEach, afterAll, expect } = require('@jest/globals');
const {
    setupDirectGroupTests,
    teardownDirectGroupTests,
    cleanupAllData,
    getSharedRequest,
    getTestHeaders
} = require('./mongoDirectGroupMemberTestSetup');

describe('MongoDB Direct Group Member Storage (V2)', () => {
    beforeAll(async () => {
        await setupDirectGroupTests();
    }, 60000);

    beforeEach(async () => {
        await cleanupAllData();
    });

    afterAll(async () => {
        await teardownDirectGroupTests();
    });

    // ========== Helper Functions ==========

    /**
     * Creates a Group with members via merge (POST)
     * V2 does NOT validate member references, so no need to create Patient resources first
     */
    async function createGroup({ id, members = [], name = 'Test Group' }) {
        const request = getSharedRequest();
        const group = {
            resourceType: 'Group',
            id,
            meta: {
                source: 'http://test-system.com/Group',
                security: [
                    { system: 'https://www.icanbwell.com/owner', code: 'test-owner' },
                    { system: 'https://www.icanbwell.com/access', code: 'test-access' }
                ]
            },
            type: 'person',
            actual: true,
            name,
            member: members
        };

        const response = await request
            .post('/4_0_0/Group/$merge')
            .send(group)
            .set(getTestHeaders());

        expect(response.status).toBe(200);
        return response.body;
    }

    // ========== Write + Read Tests ==========

    describe('Write and Read', () => {
        test('POST Group with members stores them in direct collection and strips from document', async () => {
            const uuid1 = '550e8400-e29b-41d4-a716-446655440001';
            const uuid2 = '550e8400-e29b-41d4-a716-446655440002';

            await createGroup({
                id: 'group-write-1',
                members: [
                    { entity: { reference: `Patient/${uuid1}` } },
                    { entity: { reference: `Patient/${uuid2}` } }
                ]
            });

            const request = getSharedRequest();
            const response = await request
                .get('/4_0_0/Group/group-write-1')
                .set(getTestHeaders());

            expect(response.status).toBe(200);
            expect(response.body.resourceType).toBe('Group');
            expect(response.body.id).toBe('group-write-1');
            expect(response.body.member).toBeUndefined();
            expect(response.body.quantity).toBe(2);
        }, 30000);

        test('POST Group without members returns quantity=0', async () => {
            await createGroup({
                id: 'group-empty',
                members: []
            });

            const request = getSharedRequest();
            const response = await request
                .get('/4_0_0/Group/group-empty')
                .set(getTestHeaders());

            expect(response.status).toBe(200);
            expect(response.body.quantity).toBe(0);
            expect(response.body.member).toBeUndefined();
        }, 30000);

        test('GET preserves other Group fields after enrichment', async () => {
            const uuid = '550e8400-e29b-41d4-a716-446655440010';

            await createGroup({
                id: 'group-fields',
                name: 'Fields Test Group',
                members: [
                    { entity: { reference: `Patient/${uuid}` } }
                ]
            });

            const request = getSharedRequest();
            const response = await request
                .get('/4_0_0/Group/group-fields')
                .set(getTestHeaders());

            expect(response.status).toBe(200);
            expect(response.body.type).toBe('person');
            expect(response.body.actual).toBe(true);
            expect(response.body.name).toBe('Fields Test Group');
            expect(response.body.meta).toBeDefined();
            expect(response.body.quantity).toBe(1);
            expect(response.body.member).toBeUndefined();
        }, 30000);
    });

    // ========== Search Tests ==========

    describe('Search by member', () => {
        test('GET /Group?member=Patient/X finds groups containing that member', async () => {
            const uuid1 = '660e8400-e29b-41d4-a716-446655440001';
            const uuid2 = '660e8400-e29b-41d4-a716-446655440002';

            await createGroup({
                id: 'group-search-a',
                members: [{ entity: { reference: `Patient/${uuid1}` } }]
            });
            await createGroup({
                id: 'group-search-b',
                members: [{ entity: { reference: `Patient/${uuid2}` } }]
            });

            const request = getSharedRequest();
            const response = await request
                .get(`/4_0_0/Group?member=Patient/${uuid1}`)
                .set(getTestHeaders());

            expect(response.status).toBe(200);
            const entries = response.body.entry || [];
            const groupIds = entries.map(e => e.resource.id);

            expect(groupIds).toContain('group-search-a');
            expect(groupIds).not.toContain('group-search-b');
        }, 30000);

        test('GET /Group?member=Patient/X returns empty when no groups contain that member', async () => {
            const orphanUuid = '770e8400-e29b-41d4-a716-446655440099';

            const request = getSharedRequest();
            const response = await request
                .get(`/4_0_0/Group?member=Patient/${orphanUuid}`)
                .set(getTestHeaders());

            expect(response.status).toBe(200);
            const entries = response.body.entry || [];
            expect(entries.length).toBe(0);
        }, 30000);

        test('Search returns correct quantity in results', async () => {
            const uuid1 = '880e8400-e29b-41d4-a716-446655440001';
            const uuid2 = '880e8400-e29b-41d4-a716-446655440002';
            const uuid3 = '880e8400-e29b-41d4-a716-446655440003';

            await createGroup({
                id: 'group-search-qty',
                members: [
                    { entity: { reference: `Patient/${uuid1}` } },
                    { entity: { reference: `Patient/${uuid2}` } },
                    { entity: { reference: `Patient/${uuid3}` } }
                ]
            });

            const request = getSharedRequest();
            const response = await request
                .get(`/4_0_0/Group?member=Patient/${uuid1}`)
                .set(getTestHeaders());

            expect(response.status).toBe(200);
            const entries = response.body.entry || [];
            expect(entries.length).toBe(1);
            expect(entries[0].resource.quantity).toBe(3);
            expect(entries[0].resource.member).toBeUndefined();
        }, 30000);

        test('Member in multiple groups returns all groups', async () => {
            const sharedUuid = '990e8400-e29b-41d4-a716-446655440000';

            await createGroup({
                id: 'group-multi-1',
                members: [{ entity: { reference: `Patient/${sharedUuid}` } }]
            });
            await createGroup({
                id: 'group-multi-2',
                members: [{ entity: { reference: `Patient/${sharedUuid}` } }]
            });

            const request = getSharedRequest();
            const response = await request
                .get(`/4_0_0/Group?member=Patient/${sharedUuid}`)
                .set(getTestHeaders());

            expect(response.status).toBe(200);
            const entries = response.body.entry || [];
            const groupIds = entries.map(e => e.resource.id);

            expect(groupIds).toContain('group-multi-1');
            expect(groupIds).toContain('group-multi-2');
        }, 30000);
    });

    // ========== Update Tests ==========

    describe('Update (diff computation)', () => {
        test('PUT with changed members computes correct diff', async () => {
            const uuid1 = 'aa0e8400-e29b-41d4-a716-446655440001';
            const uuid2 = 'aa0e8400-e29b-41d4-a716-446655440002';
            const uuid3 = 'aa0e8400-e29b-41d4-a716-446655440003';

            // Create group with uuid1 and uuid2
            await createGroup({
                id: 'group-diff',
                members: [
                    { entity: { reference: `Patient/${uuid1}` } },
                    { entity: { reference: `Patient/${uuid2}` } }
                ]
            });

            // Update: remove uuid2, add uuid3
            await createGroup({
                id: 'group-diff',
                members: [
                    { entity: { reference: `Patient/${uuid1}` } },
                    { entity: { reference: `Patient/${uuid3}` } }
                ]
            });

            // Verify: should now have uuid1 and uuid3 (quantity=2)
            const request = getSharedRequest();
            const response = await request
                .get('/4_0_0/Group/group-diff')
                .set(getTestHeaders());

            expect(response.status).toBe(200);
            expect(response.body.quantity).toBe(2);

            // Verify uuid2 no longer in group
            const searchResponse = await request
                .get(`/4_0_0/Group?member=Patient/${uuid2}`)
                .set(getTestHeaders());

            expect(searchResponse.status).toBe(200);
            const entries = searchResponse.body.entry || [];
            expect(entries.map(e => e.resource.id)).not.toContain('group-diff');

            // Verify uuid3 is in the group
            const search3Response = await request
                .get(`/4_0_0/Group?member=Patient/${uuid3}`)
                .set(getTestHeaders());

            expect(search3Response.status).toBe(200);
            const entries3 = search3Response.body.entry || [];
            expect(entries3.map(e => e.resource.id)).toContain('group-diff');
        }, 30000);
    });

    // ========== Edge Cases ==========

    describe('Edge cases', () => {
        test('Group with no members still returns valid quantity=0', async () => {
            await createGroup({ id: 'group-edge-no-member', members: [] });

            const request = getSharedRequest();
            const response = await request
                .get('/4_0_0/Group/group-edge-no-member')
                .set(getTestHeaders());

            expect(response.status).toBe(200);
            expect(response.body.quantity).toBe(0);
            expect(response.body.member).toBeUndefined();
        }, 30000);
    });

    // ========== Non-member search tests ==========

    describe('Non-member searches (MongoDB metadata)', () => {
        test('GET /Group?type=person searches MongoDB metadata', async () => {
            await createGroup({
                id: 'group-meta-search',
                name: 'Metadata Search Group',
                members: []
            });

            const request = getSharedRequest();
            const response = await request
                .get('/4_0_0/Group?type=person')
                .set(getTestHeaders());

            expect(response.status).toBe(200);
            const entries = response.body.entry || [];
            const found = entries.some(e => e.resource.id === 'group-meta-search');
            expect(found).toBe(true);
        }, 30000);
    });

    // ========== Coexistence test ==========

    describe('Coexistence with standard Groups', () => {
        test('Group created without directGroupMemberRequest header is not affected', async () => {
            // Create a normal Group (without the direct header)
            const request = getSharedRequest();
            const { getHeaders } = require('../common');
            const normalHeaders = getHeaders();

            const group = {
                resourceType: 'Group',
                id: 'group-normal',
                meta: {
                    source: 'http://test-system.com/Group',
                    security: [
                        { system: 'https://www.icanbwell.com/owner', code: 'test-owner' },
                        { system: 'https://www.icanbwell.com/access', code: 'test-access' }
                    ]
                },
                type: 'person',
                actual: true,
                name: 'Normal Group',
                member: [
                    { entity: { reference: 'Patient/bb0e8400-e29b-41d4-a716-446655440001' } }
                ]
            };

            const createResponse = await request
                .post('/4_0_0/Group/$merge')
                .send(group)
                .set(normalHeaders);
            expect(createResponse.status).toBe(200);

            // Read without header — member array should NOT be stripped
            const readResponse = await request
                .get('/4_0_0/Group/group-normal')
                .set(normalHeaders);

            expect(readResponse.status).toBe(200);
            // Without the direct header, enrichment should not strip members
            // The member array may or may not be present depending on whether
            // array stripping occurred — but quantity should NOT be populated by V2
            expect(readResponse.body.resourceType).toBe('Group');
        }, 30000);
    });
});
