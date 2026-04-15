const { describe, test, beforeAll, beforeEach, afterAll, expect } = require('@jest/globals');
const {
    setupGroupTests,
    teardownGroupTests,
    cleanupAllData,
    getSharedRequest,
    getClickHouseManager,
    getTestHeadersWithExternalStorage
} = require('./groupTestSetup');
const { EVENT_TYPES } = require('../../constants/clickHouseConstants');

/**
 * Group CREATE Operations Test Suite
 *
 * Verifies POST /Group behavior for:
 * - MongoDB metadata writes (via API)
 * - ClickHouse event writes (direct query)
 * - Boundary conditions (caps, limits)
 * - FHIR spec compliance (grp-1 invariant)
 *
 * Uses shared test infrastructure to avoid expensive setup/teardown per test.
 */
describe('Group CREATE operations', () => {
    beforeAll(async () => {
        await setupGroupTests();
    });

    beforeEach(async () => {
        await cleanupAllData();
    });

    afterAll(async () => {
        await teardownGroupTests();
    });

    async function createGroup(group) {
        const request = getSharedRequest();
        return await request
            .post('/4_0_0/Group')
            .send({
                resourceType: 'Group',
                ...group,
                meta: group.meta || {
                    source: 'http://test-system.com/Group',
                    security: [
                        { system: 'https://www.icanbwell.com/owner', code: 'test-owner' },
                        { system: 'https://www.icanbwell.com/access', code: 'test-access' }
                    ]
                }
            })
            .set(getTestHeadersWithExternalStorage());
    }

    test('POST Group without members → MongoDB only', async () => {
        const clickHouseManager = getClickHouseManager();
        const response = await createGroup({
            type: 'person',
            actual: true,
            name: 'Group Without Members'
        });

        expect(response.status).toBe(201);
        const groupId = response.body.id;

        // Verify metadata is stored (via GET)
        const request = getSharedRequest();
        const getResponse = await request
            .get(`/4_0_0/Group/${groupId}`)
            .set(getTestHeadersWithExternalStorage());
        expect(getResponse.status).toBe(200);
        expect(getResponse.body.name).toBe('Group Without Members');
        expect(getResponse.body.member).toBeUndefined(); // Should not include member array

        // Verify ClickHouse has no events
        const events = await clickHouseManager.queryAsync({
            query: `SELECT count() as count FROM fhir.Group_4_0_0_MemberEvents WHERE group_id = '${groupId}'`
        });
        expect(parseInt(events[0].count)).toBe(0);

    });


    test('POST Group with same member path uses same code (no threshold)', async () => {
        const clickHouseManager = getClickHouseManager();

        // Small batch
        const members50 = Array.from({ length: 50 }, (_, i) => ({
            entity: { reference: `Patient/small-${i}` }
        }));

        const response50 = await createGroup({
            type: 'person',
            actual: true,
            member: members50
        });
        expect(response50.status).toBe(201);


        // Large batch
        const members1000 = Array.from({ length: 1000 }, (_, i) => ({
            entity: { reference: `Patient/large-${i}` }
        }));

        const response1000 = await createGroup({
            type: 'person',
            actual: true,
            member: members1000
        });
        expect(response1000.status).toBe(201);


        // Both should have events in ClickHouse
        const events50 = await clickHouseManager.queryAsync({
            query: `SELECT count() as count FROM fhir.Group_4_0_0_MemberEvents
                    WHERE group_id = '${response50.body.id}' AND event_type = '${EVENT_TYPES.MEMBER_ADDED}'`
        });
        const events1000 = await clickHouseManager.queryAsync({
            query: `SELECT count() as count FROM fhir.Group_4_0_0_MemberEvents
                    WHERE group_id = '${response1000.body.id}' AND event_type = '${EVENT_TYPES.MEMBER_ADDED}'`
        });

        expect(parseInt(events50[0].count)).toBe(50);
        expect(parseInt(events1000[0].count)).toBe(1000);

    });

    test('POST Group → quantity available via GET', async () => {
        const clickHouseManager = getClickHouseManager();
        const members = Array.from({ length: 3 }, (_, i) => ({
            entity: { reference: `Patient/quantity-test-${i}` }
        }));

        const response = await createGroup({
            type: 'person',
            actual: true,
            name: 'Quantity Enrichment Test',
            member: members
        });

        expect(response.status).toBe(201);

        // Quantity not in POST response (FHIR compliant)
        // Must GET to retrieve computed field
        const groupId = response.body.id;
        const request = getSharedRequest();
        const getResponse = await request
            .get(`/4_0_0/Group/${groupId}`)
            .set(getTestHeadersWithExternalStorage());

        expect(getResponse.status).toBe(200);
        expect(getResponse.body.quantity).toBeDefined();
        expect(getResponse.body.quantity).not.toBeNull();
        expect(getResponse.body.quantity).toBe(3);
        expect(getResponse.body.member).toBeUndefined(); // Member array stripped (hybrid storage)

        // Verify ClickHouse count matches
        const events = await clickHouseManager.queryAsync({
            query: `SELECT count() as count FROM fhir.Group_4_0_0_MemberEvents
                    WHERE group_id = '${groupId}' AND event_type = '${EVENT_TYPES.MEMBER_ADDED}'`
        });
        expect(parseInt(events[0].count)).toBe(3);
    });

    test('POST Group without members → quantity=0 via GET', async () => {
        const response = await createGroup({
            type: 'person',
            actual: true,
            name: 'Empty Group Quantity Test'
        });

        expect(response.status).toBe(201);

        // GET to verify quantity
        const groupId = response.body.id;
        const request = getSharedRequest();
        const getResponse = await request
            .get(`/4_0_0/Group/${groupId}`)
            .set(getTestHeadersWithExternalStorage());

        expect(getResponse.status).toBe(200);
        expect(getResponse.body.quantity).toBeDefined();
        expect(getResponse.body.quantity).toBe(0);
        expect(getResponse.body.member).toBeUndefined();
    });
});
