const { describe, test, beforeAll, beforeEach, afterAll, expect } = require('@jest/globals');
const {
    setupGroupTests,
    teardownGroupTests,
    cleanupBetweenTests,
    getSharedRequest,
    getClickHouseManager,
    syncClickHouseMaterializedViews
} = require('./groupTestSetup');
const { getHeaders } = require('../common');
const { QueryFragments } = require('../../utils/clickHouse/queryFragments');

/**
 * Tenant Isolation Tests for Group ClickHouse Integration
 *
 * Validates that multi-tenant security boundaries are enforced:
 * - Tenant A cannot read Tenant B's Groups via FHIR API
 * - ClickHouse queries properly filter by access_tags
 * - Empty access_tags throw security violation errors
 * - Security tags are correctly stored and queried in ClickHouse
 *
 * This is a MANDATORY requirement per agent instructions:
 * "Integration tests must verify that tenant boundaries are enforced.
 * Cross-tenant data leakage is a correctness bug, not a nice-to-have test case."
 */
describe('Group Tenant Isolation with ClickHouse', () => {
    beforeAll(async () => {
        await setupGroupTests();
    });

    beforeEach(async () => {
        await cleanupBetweenTests();
    });

    afterAll(async () => {
        await teardownGroupTests();
    });

    /**
     * Helper to create a Group with specific tenant security tags
     */
    async function createGroupForTenant({ tenantCode, groupId, memberCount = 5 }) {
        const request = getSharedRequest();

        const members = Array.from({ length: memberCount }, (_, i) => ({
            entity: { reference: `Patient/${tenantCode}-patient-${i}` }
        }));

        const group = {
            resourceType: 'Group',
            id: groupId,
            meta: {
                source: `http://${tenantCode}.example.com/Group`,
                security: [
                    { system: 'https://www.icanbwell.com/owner', code: tenantCode },
                    { system: 'https://www.icanbwell.com/access', code: tenantCode }
                ]
            },
            type: 'person',
            actual: true,
            name: `${tenantCode} Test Group`,
            member: members
        };

        const response = await request
            .put(`/4_0_0/Group/${groupId}`)
            .send(group)
            .set(getHeaders(`user/*.write access/${tenantCode}.*`));

        expect(response.status).toBe(201);
        return response.body;
    }

    test('Tenant A cannot read Tenant B Groups via FHIR API', async () => {
        const request = getSharedRequest();

        // Create Groups for Tenant A and Tenant B
        const groupA = await createGroupForTenant({
            tenantCode: 'tenant-a',
            groupId: 'group-isolation-tenant-a',
            memberCount: 3
        });

        const groupB = await createGroupForTenant({
            tenantCode: 'tenant-b',
            groupId: 'group-isolation-tenant-b',
            memberCount: 3
        });

        expect(groupA.id).toBe('group-isolation-tenant-a');
        expect(groupB.id).toBe('group-isolation-tenant-b');

        // Tenant A tries to read its own Group (should succeed)
        const responseA = await request
            .get(`/4_0_0/Group/${groupA.id}`)
            .set(getHeaders('user/*.read access/tenant-a.*'));

        expect(responseA.status).toBe(200);
        expect(responseA.body.id).toBe(groupA.id);
        expect(responseA.body.quantity).toBe(3);

        // Tenant A tries to read Tenant B's Group (should fail with 404)
        const responseCrossTenant = await request
            .get(`/4_0_0/Group/${groupB.id}`)
            .set(getHeaders('user/*.read access/tenant-a.*'));

        expect(responseCrossTenant.status).toBe(404);
        // Should not leak existence of Tenant B's resource

        // Tenant B tries to read its own Group (should succeed)
        const responseB = await request
            .get(`/4_0_0/Group/${groupB.id}`)
            .set(getHeaders('user/*.read access/tenant-b.*'));

        expect(responseB.status).toBe(200);
        expect(responseB.body.id).toBe(groupB.id);
        expect(responseB.body.quantity).toBe(3);
    }, 30000);

    test('Tenant A cannot list Tenant B Groups via search', async () => {
        const request = getSharedRequest();

        // Create multiple Groups for each tenant
        await createGroupForTenant({
            tenantCode: 'tenant-a',
            groupId: 'group-search-a-1',
            memberCount: 2
        });

        await createGroupForTenant({
            tenantCode: 'tenant-a',
            groupId: 'group-search-a-2',
            memberCount: 2
        });

        await createGroupForTenant({
            tenantCode: 'tenant-b',
            groupId: 'group-search-b-1',
            memberCount: 2
        });

        await createGroupForTenant({
            tenantCode: 'tenant-b',
            groupId: 'group-search-b-2',
            memberCount: 2
        });

        // Tenant A searches for Groups (should only see Tenant A's Groups)
        const searchA = await request
            .get('/4_0_0/Group')
            .set(getHeaders('user/*.read access/tenant-a.*'));

        expect(searchA.status).toBe(200);
        expect(searchA.body.resourceType).toBe('Bundle');
        expect(searchA.body.entry).toBeDefined();

        const groupIdsA = searchA.body.entry.map(e => e.resource.id);
        expect(groupIdsA).toContain('group-search-a-1');
        expect(groupIdsA).toContain('group-search-a-2');
        expect(groupIdsA).not.toContain('group-search-b-1');
        expect(groupIdsA).not.toContain('group-search-b-2');

        // Tenant B searches for Groups (should only see Tenant B's Groups)
        const searchB = await request
            .get('/4_0_0/Group')
            .set(getHeaders('user/*.read access/tenant-b.*'));

        expect(searchB.status).toBe(200);
        const groupIdsB = searchB.body.entry.map(e => e.resource.id);
        expect(groupIdsB).toContain('group-search-b-1');
        expect(groupIdsB).toContain('group-search-b-2');
        expect(groupIdsB).not.toContain('group-search-a-1');
        expect(groupIdsB).not.toContain('group-search-a-2');
    }, 30000);

    test('ClickHouse queries filter by access_tags correctly', async () => {
        const clickhouse = getClickHouseManager();

        // Create Groups for different tenants
        await createGroupForTenant({
            tenantCode: 'tenant-x',
            groupId: 'group-clickhouse-x',
            memberCount: 10
        });

        await createGroupForTenant({
            tenantCode: 'tenant-y',
            groupId: 'group-clickhouse-y',
            memberCount: 15
        });

        // Wait for ClickHouse to process events
        await syncClickHouseMaterializedViews();
        await new Promise(resolve => setTimeout(resolve, 500));

        // Query Tenant X's members using access_tags filter
        const queryX = `
            SELECT
                entity_reference,
                argMax(event_type, (event_time, event_id)) as latest_event_type
            FROM fhir.fhir_group_member_events
            WHERE group_id = {groupId:String}
            ${QueryFragments.whereAccessTags(['tenant-x'], true)}
            GROUP BY entity_reference
            HAVING latest_event_type = 'added'
            ORDER BY entity_reference
        `;

        const membersX = await clickhouse.queryAsync({
            query: queryX,
            query_params: {
                groupId: 'group-clickhouse-x',
                accessTags: ['tenant-x']
            }
        });

        expect(membersX.length).toBe(10);
        membersX.forEach(member => {
            expect(member.entity_reference).toMatch(/^Patient\/tenant-x-patient-/);
        });

        // Query Tenant Y's members using access_tags filter
        const queryY = `
            SELECT
                entity_reference,
                argMax(event_type, (event_time, event_id)) as latest_event_type
            FROM fhir.fhir_group_member_events
            WHERE group_id = {groupId:String}
            ${QueryFragments.whereAccessTags(['tenant-y'], true)}
            GROUP BY entity_reference
            HAVING latest_event_type = 'added'
            ORDER BY entity_reference
        `;

        const membersY = await clickhouse.queryAsync({
            query: queryY,
            query_params: {
                groupId: 'group-clickhouse-y',
                accessTags: ['tenant-y']
            }
        });

        expect(membersY.length).toBe(15);
        membersY.forEach(member => {
            expect(member.entity_reference).toMatch(/^Patient\/tenant-y-patient-/);
        });

        // Tenant X trying to query Tenant Y's data should get zero results
        const crossTenantQuery = await clickhouse.queryAsync({
            query: queryX, // Using Tenant X's query
            query_params: {
                groupId: 'group-clickhouse-y', // But querying Tenant Y's group
                accessTags: ['tenant-x'] // With Tenant X's access tags
            }
        });

        // Should get zero results because access_tags don't match
        expect(crossTenantQuery.length).toBe(0);
    }, 30000);

    test('ClickHouse whereAccessTags throws on empty array (security violation)', async () => {
        // This tests QueryFragments directly, not the full FHIR API
        // Empty access tags would bypass authorization, so it must throw

        expect(() => {
            QueryFragments.whereAccessTags([]);
        }).toThrow('Security violation: accessTags cannot be empty');

        expect(() => {
            QueryFragments.whereAccessTags(null);
        }).toThrow('Security violation: accessTags cannot be empty');

        expect(() => {
            QueryFragments.whereAccessTags(undefined);
        }).toThrow('Security violation: accessTags cannot be empty');

        // Non-array should also throw
        expect(() => {
            QueryFragments.whereAccessTags('not-an-array');
        }).toThrow('Security violation: accessTags cannot be empty');
    });

    test('ClickHouse whereOwnerTags throws on empty array (security violation)', async () => {
        // Same as access tags, owner tags cannot be empty

        expect(() => {
            QueryFragments.whereOwnerTags([]);
        }).toThrow('Security violation: ownerTags cannot be empty');

        expect(() => {
            QueryFragments.whereOwnerTags(null);
        }).toThrow('Security violation: ownerTags cannot be empty');

        expect(() => {
            QueryFragments.whereOwnerTags(undefined);
        }).toThrow('Security violation: ownerTags cannot be empty');

        expect(() => {
            QueryFragments.whereOwnerTags('not-an-array');
        }).toThrow('Security violation: ownerTags cannot be empty');
    });

    test('Security tags are persisted in ClickHouse events table', async () => {
        const clickhouse = getClickHouseManager();

        await createGroupForTenant({
            tenantCode: 'tenant-persist',
            groupId: 'group-security-persist',
            memberCount: 3
        });

        // Wait for events to be written
        await syncClickHouseMaterializedViews();
        await new Promise(resolve => setTimeout(resolve, 500));

        // Query raw events table to verify security tags are stored
        const events = await clickhouse.queryAsync({
            query: `
                SELECT
                    entity_reference,
                    access_tags,
                    owner_tags
                FROM fhir.fhir_group_member_events
                WHERE group_id = {groupId:String}
                AND event_type = 'added'
                ORDER BY entity_reference
            `,
            query_params: { groupId: 'group-security-persist' }
        });

        expect(events.length).toBe(3);

        // Verify each event has correct security tags
        events.forEach(event => {
            expect(event.access_tags).toEqual(['tenant-persist']);
            expect(event.owner_tags).toEqual(['tenant-persist']);
            expect(event.entity_reference).toMatch(/^Patient\/tenant-persist-patient-/);
        });
    }, 30000);

    test('Multi-tenant access: User with multiple tenant scopes can see multiple tenants', async () => {
        const request = getSharedRequest();

        await createGroupForTenant({
            tenantCode: 'tenant-multi-1',
            groupId: 'group-multi-1',
            memberCount: 2
        });

        await createGroupForTenant({
            tenantCode: 'tenant-multi-2',
            groupId: 'group-multi-2',
            memberCount: 2
        });

        // User with access to both tenants (multi-tenant scope)
        const searchMulti = await request
            .get('/4_0_0/Group')
            .set(getHeaders('user/*.read access/tenant-multi-1.* access/tenant-multi-2.*'));

        expect(searchMulti.status).toBe(200);
        const groupIds = searchMulti.body.entry.map(e => e.resource.id);

        // Should see both tenant's Groups
        expect(groupIds).toContain('group-multi-1');
        expect(groupIds).toContain('group-multi-2');

        // User with access to only tenant-multi-1
        const searchSingle = await request
            .get('/4_0_0/Group')
            .set(getHeaders('user/*.read access/tenant-multi-1.*'));

        expect(searchSingle.status).toBe(200);
        const groupIdsSingle = searchSingle.body.entry.map(e => e.resource.id);

        // Should only see tenant-multi-1's Groups
        expect(groupIdsSingle).toContain('group-multi-1');
        expect(groupIdsSingle).not.toContain('group-multi-2');
    }, 30000);

    test('UPDATE operation preserves tenant isolation', async () => {
        const request = getSharedRequest();

        // Tenant A creates a Group
        const groupA = await createGroupForTenant({
            tenantCode: 'tenant-update-a',
            groupId: 'group-update-test',
            memberCount: 2
        });

        // Tenant A updates its own Group (should succeed)
        const updated = {
            ...groupA,
            name: 'Updated Name'
        };

        const updateResponseA = await request
            .put(`/4_0_0/Group/${groupA.id}`)
            .send(updated)
            .set(getHeaders('user/*.read user/*.write access/tenant-update-a.*'));

        expect(updateResponseA.status).toBe(200);
        expect(updateResponseA.body.name).toBe('Updated Name');

        // Tenant B tries to update Tenant A's Group (should fail)
        const updateResponseB = await request
            .put(`/4_0_0/Group/${groupA.id}`)
            .send({ ...updated, name: 'Hacked by Tenant B' })
            .set(getHeaders('user/*.write access/tenant-update-b.*'));

        // Should fail — either 403 (no access) or 404 (not found in tenant scope)
        expect([403, 404]).toContain(updateResponseB.status);

        // Verify Group was not modified by Tenant B
        const verifyResponse = await request
            .get(`/4_0_0/Group/${groupA.id}`)
            .set(getHeaders('user/*.read user/*.write access/tenant-update-a.*'));

        expect(verifyResponse.status).toBe(200);
        expect(verifyResponse.body.name).toBe('Updated Name'); // Not 'Hacked by Tenant B'
    }, 30000);

    test('PATCH operation enforces tenant boundaries', async () => {
        const request = getSharedRequest();

        // Tenant A creates a Group
        await createGroupForTenant({
            tenantCode: 'tenant-patch-a',
            groupId: 'group-patch-test',
            memberCount: 2
        });

        // Tenant A patches its own Group (should succeed)
        const patchA = [
            { op: 'add', path: '/member/-', value: { entity: { reference: 'Patient/tenant-patch-a-new' } } }
        ];

        const patchResponseA = await request
            .patch(`/4_0_0/Group/group-patch-test`)
            .send(patchA)
            .set({
                'Content-Type': 'application/json-patch+json',
                Accept: 'application/fhir+json',
                Authorization: `Bearer ${require('../common').getToken('user/*.write access/tenant-patch-a.*')}`
            });

        expect(patchResponseA.status).toBe(200);

        // Tenant B tries to patch Tenant A's Group (should fail)
        const patchB = [
            { op: 'add', path: '/member/-', value: { entity: { reference: 'Patient/tenant-patch-b-hacker' } } }
        ];

        const patchResponseB = await request
            .patch(`/4_0_0/Group/group-patch-test`)
            .send(patchB)
            .set({
                'Content-Type': 'application/json-patch+json',
                Accept: 'application/fhir+json',
                Authorization: `Bearer ${require('../common').getToken('user/*.write access/tenant-patch-b.*')}`
            });

        expect(patchResponseB.status).toBe(404);
    }, 30000);
});
