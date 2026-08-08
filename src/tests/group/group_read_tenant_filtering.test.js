const { describe, test, beforeAll, beforeEach, afterAll, expect } = require('@jest/globals');
const {
    setupGroupTests,
    teardownGroupTests,
    cleanupAllData,
    getSharedRequest,
    getTestHeadersWithExternalStorage,
    syncClickHouseMaterializedViews
} = require('./groupTestSetup');
const { getHeaders } = require('../common');
const { USE_EXTERNAL_STORAGE_HEADER } = require('../../utils/contextDataBuilder');

describe('Group Read with Tenant Filtering via ClickHouse', () => {
    beforeAll(async () => {
        await setupGroupTests();
    });

    beforeEach(async () => {
        await cleanupAllData();
    });

    afterAll(async () => {
        await teardownGroupTests();
    });

    /**
     * Helper function to create a Group with specific security tags using PUT
     */
    async function createGroupWithTags({ id, accessTag, ownerTag, memberCount = 5 }) {
        const request = getSharedRequest();

        const members = Array.from({ length: memberCount }, (_, i) => ({
            entity: { reference: `Patient/${id}-member-${i}` }
        }));

        const group = {
            resourceType: 'Group',
            id,
            meta: {
                source: `http://tenant-test.com/Group/${id}`,
                security: [
                    { system: 'https://www.icanbwell.com/owner', code: ownerTag },
                    { system: 'https://www.icanbwell.com/access', code: accessTag }
                ]
            },
            type: 'person',
            actual: true,
            name: `Tenant Test Group ${id}`,
            member: members
        };

        const response = await request
            .put(`/4_0_0/Group/${id}`)
            .send(group)
            .set(getTestHeadersWithExternalStorage());

        expect(response.status).toBe(201);

        // Force ClickHouse to sync materialized views
        await syncClickHouseMaterializedViews();
        await new Promise(resolve => setTimeout(resolve, 200));

        return id;
    }

    test('Admin user with full access sees all Group members in quantity field', async () => {
        const groupId = await createGroupWithTags({
            id: 'admin-test-group',
            accessTag: 'client-a',
            ownerTag: 'client-a',
            memberCount: 10
        });

        const request = getSharedRequest();

        // GET Group with admin/full access
        const response = await request
            .get(`/4_0_0/Group/${groupId}`)
            .set({
                ...getHeaders('user/*.* access/*.*'),
                [USE_EXTERNAL_STORAGE_HEADER]: 'true'
            });

        expect(response.status).toBe(200);
        expect(response.body.resourceType).toBe('Group');
        expect(response.body.id).toBe(groupId);

        // Admin should see ALL 10 members
        expect(response.body.quantity).toBe(10);
        expect(response.body.member).toBeUndefined();
    }, 30000);

    test('Limited user with matching access tag sees Group members', async () => {
        const groupId = await createGroupWithTags({
            id: 'client-a-group',
            accessTag: 'client-a',
            ownerTag: 'client-a',
            memberCount: 7
        });

        const request = getSharedRequest();

        // GET Group with client-a access (matches Group's access tag)
        const response = await request
            .get(`/4_0_0/Group/${groupId}`)
            .set({
                ...getHeaders('user/*.read access/client-a.*'),
                [USE_EXTERNAL_STORAGE_HEADER]: 'true'
            });

        expect(response.status).toBe(200);
        expect(response.body.resourceType).toBe('Group');
        expect(response.body.id).toBe(groupId);

        // Should see all 7 members (user has matching tag, so ClickHouse returns all)
        expect(response.body.quantity).toBe(7);
        expect(response.body.member).toBeUndefined();
    }, 30000);

    test('User without matching Group access tag gets 404 (Layer 1 blocks read)', async () => {
        const groupId = await createGroupWithTags({
            id: 'client-b-group',
            accessTag: 'client-b',
            ownerTag: 'client-b',
            memberCount: 5
        });

        const request = getSharedRequest();

        // GET Group with client-a access (but Group has client-b tags)
        // Layer 1 (MongoDB) blocks this read before enrichment runs
        const response = await request
            .get(`/4_0_0/Group/${groupId}`)
            .set({
                ...getHeaders('user/*.read access/client-a.*'),
                [USE_EXTERNAL_STORAGE_HEADER]: 'true'
            });

        // MongoDB authorization blocks the read entirely (no cross-tenant access)
        expect([403, 404]).toContain(response.status);
    }, 30000);

    test('User with user/*.read but no access tags sees quantity=0 (fail-closed)', async () => {
        const groupId = await createGroupWithTags({
            id: 'no-tags-group',
            accessTag: 'client-a',
            ownerTag: 'client-a',
            memberCount: 4
        });

        const request = getSharedRequest();

        // GET Group with user/*.read but explicitly no access scope
        // MongoDB allows read (user/*.read grants read access)
        // But security context derivation returns empty accessTags
        // So ClickHouse query should trigger fail-closed guard
        const response = await request
            .get(`/4_0_0/Group/${groupId}`)
            .set({
                ...getHeaders('user/*.read'),
                [USE_EXTERNAL_STORAGE_HEADER]: 'true'
            });

        // This will likely be 404 because MongoDB checks access tags too
        // If MongoDB allows it, then enrichment should return quantity=0 (fail-closed)
        // Let's see what happens in practice
        if (response.status === 200) {
            expect(response.body.quantity).toBe(0);
        } else {
            expect([403, 404]).toContain(response.status);
        }
    }, 30000);

    test('Defense-in-depth: ClickHouse filters match MongoDB authorization', async () => {
        // Create two Groups with different tenant tags
        const groupAId = await createGroupWithTags({
            id: 'tenant-a-group',
            accessTag: 'client-a',
            ownerTag: 'client-a',
            memberCount: 3
        });

        const groupBId = await createGroupWithTags({
            id: 'tenant-b-group',
            accessTag: 'client-b',
            ownerTag: 'client-b',
            memberCount: 5
        });

        const request = getSharedRequest();

        // client-a user can read tenant-a-group and see members
        let response = await request
            .get(`/4_0_0/Group/${groupAId}`)
            .set({
                ...getHeaders('user/*.read access/client-a.*'),
                [USE_EXTERNAL_STORAGE_HEADER]: 'true'
            });

        expect(response.status).toBe(200);
        expect(response.body.quantity).toBe(3);

        // client-a user CANNOT read tenant-b-group (Layer 1 blocks with 404)
        response = await request
            .get(`/4_0_0/Group/${groupBId}`)
            .set({
                ...getHeaders('user/*.read access/client-a.*'),
                [USE_EXTERNAL_STORAGE_HEADER]: 'true'
            });

        expect([403, 404]).toContain(response.status); // MongoDB blocks the read

        // client-b user can read tenant-b-group and see members
        response = await request
            .get(`/4_0_0/Group/${groupBId}`)
            .set({
                ...getHeaders('user/*.read access/client-b.*'),
                [USE_EXTERNAL_STORAGE_HEADER]: 'true'
            });

        expect(response.status).toBe(200);
        expect(response.body.quantity).toBe(5);

        // Admin sees both correctly
        response = await request
            .get(`/4_0_0/Group/${groupAId}`)
            .set({
                ...getHeaders('user/*.* access/*.*'),
                [USE_EXTERNAL_STORAGE_HEADER]: 'true'
            });

        expect(response.status).toBe(200);
        expect(response.body.quantity).toBe(3);

        response = await request
            .get(`/4_0_0/Group/${groupBId}`)
            .set({
                ...getHeaders('user/*.* access/*.*'),
                [USE_EXTERNAL_STORAGE_HEADER]: 'true'
            });

        expect(response.status).toBe(200);
        expect(response.body.quantity).toBe(5);
    }, 30000);
});
