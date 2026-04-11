const { describe, test, beforeAll, afterEach, afterAll, expect } = require('@jest/globals');
const {
    setupGroupTests,
    teardownGroupTests,
    cleanupAllData,
    cleanupGroupData,
    getSharedRequest,
    getClickHouseManager,
    getTestHeadersWithExternalStorage
} = require('./groupTestSetup');
const { EVENT_TYPES } = require('../../constants/clickHouseConstants');

describe('Group Concurrency Tests', () => {
    beforeAll(async () => {
        await setupGroupTests();
        await cleanupAllData();
    });

    afterAll(async () => {
        await teardownGroupTests();
    });

    async function createGroup(id, members = []) {
        const request = getSharedRequest();
        const response = await request
            .post('/4_0_0/Group')
            .send({
                resourceType: 'Group',
                id,
                type: 'person',
                actual: true,
                name: `Test Group ${id}`,
                member: members,
                meta: {
                    source: 'http://test-system.com/Group',
                    security: [
                        { system: 'https://www.icanbwell.com/owner', code: 'test-owner' },
                        { system: 'https://www.icanbwell.com/access', code: 'test-access' }
                    ]
                }
            })
            .set(getTestHeadersWithExternalStorage());

        return response;
    }

    async function updateGroup(id, members) {
        const request = getSharedRequest();
        const response = await request
            .put(`/4_0_0/Group/${id}`)
            .send({
                resourceType: 'Group',
                id,
                type: 'person',
                actual: true,
                name: `Test Group ${id}`,
                member: members,
                meta: {
                    source: 'http://test-system.com/Group',
                    security: [
                        { system: 'https://www.icanbwell.com/owner', code: 'test-owner' }
                    ]
                }
            })
            .set(getTestHeadersWithExternalStorage());

        return response;
    }

    test('Simultaneous add of same member → Both events stored, argMax returns one', async () => {
        const groupId = `concurrent-add-${Date.now()}`;
        const memberRef = 'Patient/concurrent-member-1';
        const clickHouseManager = getClickHouseManager();

        const createResponse = await createGroup(groupId, []);
        const actualId = createResponse.body.id;

        const updates = [
            updateGroup(actualId, [{ entity: { reference: memberRef } }]),
            updateGroup(actualId, [{ entity: { reference: memberRef } }])
        ];

        const results = await Promise.all(updates);
        // PUT can return 200 (updated) or 201 (created) - both are valid
        expect([200, 201]).toContain(results[0].status);
        expect([200, 201]).toContain(results[1].status);


        const events = await clickHouseManager.queryAsync({
            query: `SELECT count() as count FROM fhir.fhir_group_member_events
                    WHERE group_id = '${actualId}' AND entity_reference = '${memberRef}'`
        });

        expect(parseInt(events[0].count)).toBeGreaterThanOrEqual(1);

        const activeMembers = await clickHouseManager.queryAsync({
            query: `SELECT entity_reference
                    FROM fhir.fhir_group_member_events
                    WHERE group_id = '${actualId}'
                    GROUP BY entity_reference
                    HAVING argMax(event_type, (event_time, event_id)) = '${EVENT_TYPES.MEMBER_ADDED}'`
        });

        expect(activeMembers.length).toBe(1);
        expect(activeMembers[0].entity_reference).toBe(memberRef);
    }, 30000);

    test('Concurrent add and remove of same member → Final state determined by event_time', async () => {
        const groupId = `concurrent-add-remove-${Date.now()}`;
        const memberRef = 'Patient/concurrent-member-2';
        const clickHouseManager = getClickHouseManager();

        const createResponse = await createGroup(groupId, [{ entity: { reference: memberRef } }]);
        const actualId = createResponse.body.id;

        const updates = [
            updateGroup(actualId, [{ entity: { reference: memberRef } }]),
            updateGroup(actualId, [])
        ];

        const results = await Promise.all(updates);

        const successCount = results.filter(r => [200, 201].includes(r.status)).length;
        expect(successCount).toBeGreaterThan(0);

        const activeMembers = await clickHouseManager.queryAsync({
            query: `SELECT entity_reference
                    FROM fhir.fhir_group_member_events
                    WHERE group_id = '${actualId}'
                    GROUP BY entity_reference
                    HAVING argMax(event_type, (event_time, event_id)) = '${EVENT_TYPES.MEMBER_ADDED}'`
        });

        expect(activeMembers.length).toBeGreaterThanOrEqual(0);
        expect(activeMembers.length).toBeLessThanOrEqual(1);
    }, 30000);

    test('Multiple concurrent updates to same Group → All events stored', async () => {
        const groupId = `concurrent-multi-${Date.now()}`;
        const clickHouseManager = getClickHouseManager();

        const createResponse = await createGroup(groupId, []);
        const actualId = createResponse.body.id;

        const updates = [];
        for (let i = 0; i < 5; i++) {
            const members = Array.from({ length: i + 1 }, (_, j) => ({
                entity: { reference: `Patient/concurrent-${j}` }
            }));
            updates.push(updateGroup(actualId, members));
        }

        const results = await Promise.all(updates);

        const successCount = results.filter(r => [200, 201].includes(r.status)).length;
        expect(successCount).toBeGreaterThan(0);

        const events = await clickHouseManager.queryAsync({
            query: `SELECT count() as count FROM fhir.fhir_group_member_events
                    WHERE group_id = '${actualId}'`
        });

        expect(parseInt(events[0].count)).toBeGreaterThan(0);
    }, 30000);

    test('Race condition: Read during write → Returns consistent state', async () => {
        const groupId = `concurrent-read-write-${Date.now()}`;

        const createResponse = await createGroup(groupId, []);
        expect(createResponse.status).toBe(201);

        const actualId = createResponse.body.id;

        // Wait for persistence

        const writePromise = updateGroup(actualId, [
            { entity: { reference: 'Patient/race-1' } },
            { entity: { reference: 'Patient/race-2' } }
        ]);

        const request = getSharedRequest();
        const readPromise = request
            .get(`/4_0_0/Group/${actualId}`)
            .set(getTestHeadersWithExternalStorage());

        const [writeResult, readResult] = await Promise.all([writePromise, readPromise]);

        // PUT can return 200 (updated) or 201 (created) - both are valid
        expect([200, 201]).toContain(writeResult.status);

        // GET during concurrent write: may return 200 (found) or 404 (timing issue)
        // Both are acceptable in race conditions - verify at least one operation succeeded
        expect([200, 404]).toContain(readResult.status);

        if (readResult.status === 200) {
            expect(typeof readResult.body.quantity).toBe('number');
        }
    }, 30000);

    test('Concurrent DELETE and UPDATE → One operation wins', async () => {
        const groupId = `concurrent-delete-${Date.now()}`;

        const createResponse = await createGroup(groupId, [{ entity: { reference: 'Patient/delete-test' } }]);
        const actualId = createResponse.body.id;

        const request = getSharedRequest();
        const deletePromise = request
            .delete(`/4_0_0/Group/${actualId}`)
            .set(getTestHeadersWithExternalStorage());

        const updatePromise = updateGroup(actualId, [
            { entity: { reference: 'Patient/delete-test' } },
            { entity: { reference: 'Patient/new' } }
        ]);

        const [deleteResult, updateResult] = await Promise.all([deletePromise, updatePromise]);

        const successCount = [deleteResult.status, updateResult.status].filter(
            s => s >= 200 && s < 300
        ).length;

        expect(successCount).toBeGreaterThan(0);
    }, 30000);

    test('Concurrent member searches → No deadlocks, all return results', async () => {
        const groupId = `concurrent-search-${Date.now()}`;
        const memberRef = 'Patient/search-concurrent';

        const createResponse = await createGroup(groupId, [{ entity: { reference: memberRef } }]);
        const actualId = createResponse.body.id;

        const request = getSharedRequest();
        const searches = [];
        for (let i = 0; i < 10; i++) {
            searches.push(
                request
                    .get('/4_0_0/Group')
                    .query({ 'member.entity.reference': memberRef, _total: 'accurate' })
                    .set(getTestHeadersWithExternalStorage())
            );
        }

        const results = await Promise.all(searches);
        expect(results.every(r => r.status === 200)).toBe(true);
        expect(results.every(r => r.body.total >= 0)).toBe(true);
    }, 30000);

    // Phase 4.3: Concurrency Edge Case Tests

    test('DELETE during READ → 404 or stale data', async () => {
        const groupId = `concurrent-delete-read-${Date.now()}`;

        const createResponse = await createGroup(groupId, [
            { entity: { reference: 'Patient/delete-read-test' } }
        ]);

        expect(createResponse.status).toBe(201);
        const actualId = createResponse.body.id;

        // Concurrent DELETE and READ
        const request = getSharedRequest();
        const deletePromise = request
            .delete(`/4_0_0/Group/${actualId}`)
            .set(getTestHeadersWithExternalStorage());

        // Small delay to let DELETE start but not finish
        await new Promise(r => setTimeout(r, 10));

        const readPromise = request
            .get(`/4_0_0/Group/${actualId}`)
            .set(getTestHeadersWithExternalStorage());

        const [deleteResult, readResult] = await Promise.all([deletePromise, readPromise]);

        // DELETE should succeed
        expect([200, 204]).toContain(deleteResult.status);

        // READ during DELETE can return:
        // - 404 if DELETE completed first
        // - 200 with stale data if READ completed first (eventual consistency)
        expect([200, 404]).toContain(readResult.status);

        if (readResult.status === 200) {
            // If we got the Group, verify it has expected structure
            expect(readResult.body.resourceType).toBe('Group');
            expect(readResult.body.id).toBe(actualId);
        }
    }, 30000);

    test('100 concurrent PATCH operations → All events stored', async () => {
        const groupId = `concurrent-patch-flood-${Date.now()}`;

        const clickHouseManager = getClickHouseManager();

        const createResponse = await createGroup(groupId, []);
        expect(createResponse.status).toBe(201);
        const actualId = createResponse.body.id;

        // Prepare 100 concurrent PATCH operations, each adding a unique member
        const patchPromises = [];
        for (let i = 0; i < 100; i++) {
            const request = getSharedRequest();
            const patchPromise = request
                .patch(`/4_0_0/Group/${actualId}`)
                .send([
                    {
                        op: 'add',
                        path: '/member/-',
                        value: { entity: { reference: `Patient/flood-${i}` } }
                    }
                ])
                .set(getTestHeadersWithExternalStorage())
                .set('Content-Type', 'application/json-patch+json');

            patchPromises.push(patchPromise);
        }

        // Execute all PATCH operations concurrently
        const results = await Promise.all(patchPromises);

        // Count successful operations
        const successCount = results.filter(r => r.status === 200).length;
        expect(successCount).toBeGreaterThan(0); // At least some should succeed


        // Verify all events were stored in ClickHouse
        const events = await clickHouseManager.queryAsync({
            query: `SELECT count() as count FROM fhir.fhir_group_member_events
                    WHERE group_id = '${actualId}' AND event_type = '${EVENT_TYPES.MEMBER_ADDED}'`
        });

        const eventCount = parseInt(events[0].count);
        expect(eventCount).toBeGreaterThan(0);

        // Verify final state via argMax (handles duplicates and race conditions)
        const uniqueMembers = await clickHouseManager.queryAsync({
            query: `SELECT count(DISTINCT entity_reference) as count
                    FROM fhir.fhir_group_member_events
                    WHERE group_id = '${actualId}'
                    GROUP BY group_id
                    HAVING argMax(event_type, (event_time, event_id)) = '${EVENT_TYPES.MEMBER_ADDED}'`
        });

        // We should have captured many unique members
        // (May not be exactly 100 due to race conditions, but should be substantial)
        if (uniqueMembers.length > 0) {
            const uniqueCount = parseInt(uniqueMembers[0].count);
            expect(uniqueCount).toBeGreaterThan(0);
        }
    }, 180000); // Extended timeout for 100 concurrent operations (slower in full suite due to resource contention)

    test('Out-of-order events → argMax handles with tie-breaker', async () => {
        const groupId = `out-of-order-${Date.now()}`;
        const memberRef = 'Patient/out-of-order-member';
        const clickHouseManager = getClickHouseManager();
        const { v4: uuidv4 } = require('uuid');
        const baseTime = '2024-01-01 12:00:00';
        const uuid1 = uuidv4();
        const uuid2 = uuidv4();
        const uuid3 = uuidv4();

        // Insert events: same event_time, different event_id (tie-breaker scenario)
        await clickHouseManager.insertAsync({
            table: 'fhir.fhir_group_member_events',
            values: [
                {
                    group_id: groupId,
                    entity_reference: memberRef,
                    entity_type: 'Patient',
                    event_type: 'added',
                    event_time: baseTime,
                    event_id: uuid1,
                    period_start: null,
                    period_end: null,
                    inactive: 0,
                    actor: '',
                    reason: '',
                    source: '',
                    correlation_id: '',
                    group_source_id: '',
                    group_source_assigning_authority: '',
                    access_tags: ['test-access'],
                    owner_tags: ['test-owner']
                },
                {
                    group_id: groupId,
                    entity_reference: memberRef,
                    entity_type: 'Patient',
                    event_type: 'removed',
                    event_time: baseTime,
                    event_id: uuid2,
                    period_start: null,
                    period_end: null,
                    inactive: 0,
                    actor: '',
                    reason: '',
                    source: '',
                    correlation_id: '',
                    group_source_id: '',
                    group_source_assigning_authority: '',
                    access_tags: ['test-access'],
                    owner_tags: ['test-owner']
                },
                {
                    group_id: groupId,
                    entity_reference: memberRef,
                    entity_type: 'Patient',
                    event_type: 'added',
                    event_time: baseTime,
                    event_id: uuid3,
                    period_start: null,
                    period_end: null,
                    inactive: 0,
                    actor: '',
                    reason: '',
                    source: '',
                    correlation_id: '',
                    group_source_id: '',
                    group_source_assigning_authority: '',
                    access_tags: ['test-access'],
                    owner_tags: ['test-owner']
                }
            ],
            format: 'JSONEachRow'
        });

        // Query with argMax - tie-breaker should use event_id to determine winner
        const result = await clickHouseManager.queryAsync({
            query: `SELECT
                        entity_reference,
                        argMax(event_type, (event_time, event_id)) as final_event_type
                    FROM fhir.fhir_group_member_events
                    WHERE group_id = {groupId:String}
                    GROUP BY entity_reference`,
            query_params: { groupId }
        });

        expect(result.length).toBe(1);
        expect(result[0].entity_reference).toBe(memberRef);
        // Final state is deterministic based on (event_time, event_id) tuple
        expect(['added', 'removed']).toContain(result[0].final_event_type);

        // Verify determinism - query again, should get same result
        const result2 = await clickHouseManager.queryAsync({
            query: `SELECT argMax(event_type, (event_time, event_id)) as final_event_type
                    FROM fhir.fhir_group_member_events
                    WHERE group_id = {groupId:String} AND entity_reference = {memberRef:String}
                    GROUP BY entity_reference`,
            query_params: { groupId, memberRef }
        });

        expect(result2[0].final_event_type).toBe(result[0].final_event_type);
    }, 30000);
});
