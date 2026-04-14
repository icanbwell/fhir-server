
const { describe, test, beforeAll, beforeEach, afterAll, expect } = require('@jest/globals');
const {
    setupGroupTests,
    teardownGroupTests,
    cleanupAllData,
    getSharedRequest,
    getClickHouseManager,
    getTestHeaders
} = require('./groupTestSetup');
const { EVENT_TYPES } = require('../../constants/clickHouseConstants');

/**
 * Group DELETE Operations Test Suite
 *
 * Verifies DELETE /Group/{id} behavior:
 * - MongoDB metadata deleted (verified via 404 on GET)
 * - ClickHouse events retained (audit trail)
 * - GET returns 404 after delete
 * - Orphaned events are harmless
 */
describe('Group DELETE operations', () => {
    let clickHouseManager;

    beforeAll(async () => {
        await setupGroupTests();
        clickHouseManager = getClickHouseManager();
    });

    beforeEach(async () => {
        await cleanupAllData();
    });

    afterAll(async () => {
        await teardownGroupTests();
    });

    async function createGroup(group) {
        const request = getSharedRequest();
        const response = await request
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
            .set(getTestHeaders());
        return response.body;
    }

    async function deleteGroup(groupId) {
        const request = getSharedRequest();
        return await request
            .delete(`/4_0_0/Group/${groupId}`)
            .set(getTestHeaders());
    }

    async function getGroup(groupId) {
        const request = getSharedRequest();
        return await request
            .get(`/4_0_0/Group/${groupId}`)
            .set(getTestHeaders());
    }

    test('DELETE Group → MongoDB deleted, ClickHouse events remain', async () => {
        const members = Array.from({ length: 5 }, (_, i) => ({
            entity: { reference: `Patient/delete-${i}` }
        }));

        const created = await createGroup({
            type: 'person',
            actual: true,
            member: members
        });


        // Verify events exist before delete
        const eventsBefore = await clickHouseManager.queryAsync({
            query: `SELECT count() as count FROM fhir.fhir_group_member_events
                    WHERE group_id = '${created.id}'`
        });
        expect(parseInt(eventsBefore[0].count)).toBe(5);

        // Delete the Group
        const deleteResponse = await deleteGroup(created.id);
        expect([200, 204]).toContain(deleteResponse.status);


        // Verify Group is deleted (GET returns 404)
        const getResponse = await getGroup(created.id);
        expect(getResponse.status).toBe(404);

        // ClickHouse should still have events (audit trail)
        const eventsAfter = await clickHouseManager.queryAsync({
            query: `SELECT count() as count FROM fhir.fhir_group_member_events
                    WHERE group_id = '${created.id}'`
        });
        expect(parseInt(eventsAfter[0].count)).toBe(5);

    });

    test('GET deleted Group → 404', async () => {
        const created = await createGroup({
            type: 'person',
            actual: true
        });

        await deleteGroup(created.id);

        const response = await getGroup(created.id);
        expect(response.status).toBe(404);

    });

    test('ClickHouse events visible after delete (audit trail)', async () => {
        const members = Array.from({ length: 3 }, (_, i) => ({
            entity: { reference: `Patient/delete-audit-${i}` }
        }));

        const created = await createGroup({
            type: 'person',
            actual: true,
            member: members
        });


        const membersBefore = await clickHouseManager.queryAsync({
            query: `SELECT entity_reference FROM fhir.fhir_group_member_events
                    WHERE group_id = '${created.id}' AND event_type = '${EVENT_TYPES.MEMBER_ADDED}'
                    ORDER BY entity_reference`
        });
        expect(membersBefore.length).toBe(3);

        await deleteGroup(created.id);

        // Events should still be directly queryable in ClickHouse
        const membersAfter = await clickHouseManager.queryAsync({
            query: `SELECT entity_reference FROM fhir.fhir_group_member_events
                    WHERE group_id = '${created.id}' AND event_type = '${EVENT_TYPES.MEMBER_ADDED}'
                    ORDER BY entity_reference`
        });

        expect(membersAfter.length).toBe(membersBefore.length);
        expect(membersAfter.map(m => m.entity_reference)).toEqual(
            membersBefore.map(m => m.entity_reference)
        );

    });
});
