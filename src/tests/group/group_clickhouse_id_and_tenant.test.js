const { describe, test, beforeAll, beforeEach, afterAll, expect } = require('@jest/globals');
const {
    setupGroupTests,
    teardownGroupTests,
    cleanupAllData,
    getSharedRequest,
    getClickHouseManager,
    getTestHeadersWithExternalStorage,
    syncClickHouseMaterializedViews,
    waitForData
} = require('./groupTestSetup');
const { getHeaders } = require('../common');
const { USE_EXTERNAL_STORAGE_HEADER } = require('../../utils/contextDataBuilder');

/**
 * ClickHouse Group member search: `_id` filter and cross-tenant isolation
 *
 * These tests exercise the MONGO_WITH_CLICKHOUSE member-search path
 * (GET /Group?member=Patient/X) routed through ClickHouse:
 *
 * (a) When an `_id` constraint is supplied alongside `member`, only the
 *     requested Group is returned. ClickHouse filters by member only, so the
 *     requested id(s) must be intersected with the ClickHouse result set.
 *     Before the EA-2316 fix, every Group containing the member was returned.
 *
 * (b) Tenant isolation: a search scoped to one tenant's access tag must not
 *     return Groups owned by a different tenant, even when both contain the
 *     same member. This is permanent coverage for the security filter.
 */
describe('Group ClickHouse member search: _id filter and tenant isolation', () => {
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
     * Builds meta with owner + access security tags for a given tenant code.
     * @param {string} code - Owner and access tag code (the tenant)
     * @returns {Object} FHIR meta object
     */
    function metaForTenant(code) {
        return {
            source: `http://test-system.com/Group|${code}`,
            security: [
                { system: 'https://www.icanbwell.com/owner', code },
                { system: 'https://www.icanbwell.com/access', code }
            ]
        };
    }

    /**
     * Creates a Group containing a single member and returns its server id.
     * @param {Object} params
     * @param {string} params.name - Group name
     * @param {string} params.memberReference - member.entity.reference value
     * @param {Object} params.meta - FHIR meta (owner/access tags)
     * @param {Object} params.headers - Request headers
     * @returns {Promise<string>} The created Group id
     */
    async function createGroupWithMember({ name, memberReference, meta, headers }) {
        const request = getSharedRequest();
        const response = await request
            .post('/4_0_0/Group')
            .send({
                resourceType: 'Group',
                type: 'person',
                actual: true,
                name,
                member: [{ entity: { reference: memberReference } }],
                meta
            })
            .set(headers);

        expect(response.status).toBe(201);
        return response.body.id;
    }

    /**
     * Waits until ClickHouse has recorded the member event for the given group,
     * then forces materialized view sync so searches see current state.
     * @param {string} groupId - Group id to wait on
     * @returns {Promise<void>}
     */
    async function waitForMemberEvent(groupId) {
        const clickHouseManager = getClickHouseManager();
        await waitForData(
            async () => {
                const events = await clickHouseManager.queryAsync({
                    query: `SELECT count() as count FROM fhir.Group_4_0_0_MemberEvents WHERE group_id = '${groupId}'`
                });
                return parseInt(events[0].count) === 1;
            },
            { description: `ClickHouse member event for group ${groupId}` }
        );
    }

    test('_id filter honored: member=X&_id=G1 returns only G1', async () => {
        const request = getSharedRequest();
        const headers = getTestHeadersWithExternalStorage();
        const memberReference = 'Patient/idtest-shared';
        const meta = metaForTenant('test-owner');

        // Two groups, same tenant, both containing the same member
        const g1 = await createGroupWithMember({
            name: 'Id Filter Group 1',
            memberReference,
            meta,
            headers
        });
        const g2 = await createGroupWithMember({
            name: 'Id Filter Group 2',
            memberReference,
            meta,
            headers
        });

        await waitForMemberEvent(g1);
        await waitForMemberEvent(g2);
        await syncClickHouseMaterializedViews();

        // Search by member AND _id=g1 → only g1 should come back
        const searchResponse = await request
            .get(`/4_0_0/Group?member=${memberReference}&_id=${g1}`)
            .set(headers);

        expect(searchResponse.status).toBe(200);
        const bundle = searchResponse.body;
        expect(bundle.resourceType).toBe('Bundle');
        expect(bundle.entry).toBeDefined();

        const foundIds = bundle.entry.map((e) => e.resource.id);
        expect(foundIds).toContain(g1);
        expect(foundIds).not.toContain(g2);
        expect(foundIds).toHaveLength(1);
    });

    test('cross-tenant isolation: tenantA-scoped search excludes tenantB group', async () => {
        const request = getSharedRequest();
        const writeHeaders = getTestHeadersWithExternalStorage();
        const memberReference = 'Patient/shared-xtenant';

        // Two groups owned by different tenants, both containing the same member
        const ga = await createGroupWithMember({
            name: 'Tenant A Group',
            memberReference,
            meta: metaForTenant('tenantaaa'),
            headers: writeHeaders
        });
        const gb = await createGroupWithMember({
            name: 'Tenant B Group',
            memberReference,
            meta: metaForTenant('tenantbbb'),
            headers: writeHeaders
        });

        await waitForMemberEvent(ga);
        await waitForMemberEvent(gb);
        await syncClickHouseMaterializedViews();

        // Search scoped to tenant A's access tag → only tenant A's group
        const scopedHeaders = {
            ...getHeaders('user/*.* access/tenantaaa.*'),
            [USE_EXTERNAL_STORAGE_HEADER]: 'true'
        };

        const searchResponse = await request
            .get(`/4_0_0/Group?member=${memberReference}`)
            .set(scopedHeaders);

        expect(searchResponse.status).toBe(200);
        const bundle = searchResponse.body;
        expect(bundle.resourceType).toBe('Bundle');
        expect(bundle.entry).toBeDefined();

        const foundIds = bundle.entry.map((e) => e.resource.id);
        expect(foundIds).toContain(ga);
        expect(foundIds).not.toContain(gb);
    });
});
