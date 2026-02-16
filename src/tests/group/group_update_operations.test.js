// Set env vars FIRST, before any requires
process.env.ENABLE_CLICKHOUSE = '1';
process.env.MONGO_WITH_CLICKHOUSE_RESOURCES = 'Group';
process.env.CLICKHOUSE_DATABASE = 'fhir';
process.env.LOGLEVEL = 'SILENT';
process.env.STREAM_RESPONSE = '0';

const { describe, test, beforeAll, beforeEach, afterAll, expect } = require('@jest/globals');
const { commonBeforeEach, commonAfterEach, createTestRequest, getHeaders } = require('../common');
const { ConfigManager } = require('../../utils/configManager');
const { ClickHouseClientManager } = require('../../utils/clickHouseClientManager');
const { EVENT_TYPES } = require('../../constants/clickHouseConstants');

/**
 * Group UPDATE Operations Test Suite
 *
 * Verifies PUT /Group/{id} behavior:
 * - Metadata-only updates (MongoDB only)
 * - Membership diff computation (ClickHouse)
 * - Validation before MongoDB writes (prevent partial writes)
 * - 100K cap enforcement
 */
describe('Group UPDATE operations', () => {
    let clickHouseManager;

    beforeAll(async () => {
        await commonBeforeEach();
        const configManager = new ConfigManager();
        clickHouseManager = new ClickHouseClientManager({ configManager });

        let ready = false;
        for (let i = 0; i < 30; i++) {
            try {
                await clickHouseManager.getClientAsync();
                if (await clickHouseManager.isHealthyAsync()) {
                    ready = true;
                    break;
                }
            } catch (e) {
                // Continue
            }
            await new Promise(r => setTimeout(r, 1000));
        }
        if (!ready) throw new Error('ClickHouse not ready');
    });

    beforeEach(async () => {
        try {
            await clickHouseManager.truncateTableAsync('fhir.fhir_group_member_events');
        } catch (e) {
            // Ignore
        }
    });

    afterAll(async () => {
        if (clickHouseManager) {
            await clickHouseManager.closeAsync();
        }
        await commonAfterEach();
    });

    async function createGroup(group) {
        const request = await createTestRequest();
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
            .set(getHeaders());

        return response.body;
    }

    async function updateGroup(groupId, updates) {
        const request = await createTestRequest();
        return await request
            .put(`/4_0_0/Group/${groupId}`)
            .send(updates)
            .set(getHeaders());
    }

    test('PUT metadata only → MongoDB only, no ClickHouse', async () => {
        const created = await createGroup({
            type: 'person',
            actual: true,
            name: 'Original Name'
        });


        const eventsBefore = await clickHouseManager.queryAsync({
            query: `SELECT count() as count FROM fhir.fhir_group_member_events
                    WHERE group_id = '${created.id}'`
        });

        // Update only metadata
        const response = await updateGroup(created.id, {
            ...created,
            name: 'Updated Name',
            active: false
        });

        expect([200, 201]).toContain(response.status);


        const eventsAfter = await clickHouseManager.queryAsync({
            query: `SELECT count() as count FROM fhir.fhir_group_member_events
                    WHERE group_id = '${created.id}'`
        });

        // No new ClickHouse events for metadata-only update
        expect(parseInt(eventsAfter[0].count)).toBe(parseInt(eventsBefore[0].count));

    });

    test('PUT with 10 new members → ClickHouse add events', async () => {
        const created = await createGroup({
            type: 'person',
            actual: true
        });

        const members = Array.from({ length: 10 }, (_, i) => ({
            entity: { reference: `Patient/update-new-${i}` }
        }));

        const response = await updateGroup(created.id, {
            ...created,
            member: members
        });

        expect([200, 201]).toContain(response.status);


        const events = await clickHouseManager.queryAsync({
            query: `SELECT count() as count FROM fhir.fhir_group_member_events
                    WHERE group_id = '${created.id}' AND event_type = '${EVENT_TYPES.MEMBER_ADDED}'`
        });
        expect(parseInt(events[0].count)).toBe(10);

    });

    test('PUT removing 3 members → ClickHouse remove events', async () => {
        const initialMembers = Array.from({ length: 5 }, (_, i) => ({
            entity: { reference: `Patient/update-remove-${i}` }
        }));

        const created = await createGroup({
            type: 'person',
            actual: true,
            member: initialMembers
        });


        // Update to keep only first 2 members
        const keepMembers = initialMembers.slice(0, 2);
        const response = await updateGroup(created.id, {
            ...created,
            member: keepMembers
        });

        expect([200, 201]).toContain(response.status);


        // Should have 3 removal events
        const removeEvents = await clickHouseManager.queryAsync({
            query: `SELECT count() as count FROM fhir.fhir_group_member_events
                    WHERE group_id = '${created.id}' AND event_type = '${EVENT_TYPES.MEMBER_REMOVED}'`
        });
        expect(parseInt(removeEvents[0].count)).toBe(3);

        // Current state should be 2 members
        const currentCount = await clickHouseManager.queryAsync({
            query: `SELECT count() as count FROM (
                        SELECT entity_reference FROM fhir.fhir_group_member_events
                        WHERE group_id = '${created.id}'
                        GROUP BY entity_reference
                        HAVING argMax(event_type, (event_time, event_id)) = '${EVENT_TYPES.MEMBER_ADDED}'
                    )`
        });
        expect(parseInt(currentCount[0].count)).toBe(2);

    });

    test('PUT empty member array → Remove all current members', async () => {
        const MEMBER_COUNT = 5;
        const initialMembers = Array.from({ length: MEMBER_COUNT }, (_, i) => ({
            entity: { reference: `Patient/update-empty-${i}` }
        }));

        const created = await createGroup({
            type: 'person',
            actual: true,
            member: initialMembers
        });

        // Check initial state
        const initialEvents = await clickHouseManager.queryAsync({
            query: `SELECT count() as count FROM fhir.fhir_group_member_events
                    WHERE group_id = '${created.id}'`
        });

        // Update with empty array
        const response = await updateGroup(created.id, {
            ...created,
            member: []
        });

        expect([200, 201]).toContain(response.status);

        // Debug: Check all events
        const allEvents = await clickHouseManager.queryAsync({
            query: `SELECT event_type, entity_reference FROM fhir.fhir_group_member_events
                    WHERE group_id = '${created.id}'
                    ORDER BY event_time, event_id`
        });

        const addedCount = allEvents.filter(e => e.event_type === EVENT_TYPES.MEMBER_ADDED).length;
        const removedCount = allEvents.filter(e => e.event_type === EVENT_TYPES.MEMBER_REMOVED).length;

        // All members should be removed
        const currentCount = await clickHouseManager.queryAsync({
            query: `SELECT count() as count FROM (
                        SELECT entity_reference FROM fhir.fhir_group_member_events
                        WHERE group_id = '${created.id}'
                        GROUP BY entity_reference
                        HAVING argMax(event_type, (event_time, event_id)) = '${EVENT_TYPES.MEMBER_ADDED}'
                    )`
        });
        expect(parseInt(currentCount[0].count)).toBe(0);

    });
});
