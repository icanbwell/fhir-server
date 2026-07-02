/**
 * Group ClickHouse Performance SMOKE Test (CI-runnable)
 *
 * A deliberately small, fast, testcontainer-based performance check that CAN run in
 * CI on every change - unlike the heavyweight 1M-member load tests in this directory,
 * which are opt-in and too slow/expensive for the normal pipeline.
 *
 * What it guards:
 * - A few-thousand-member bulk PATCH load completes end-to-end without hanging or
 *   crashing (catches catastrophic regressions: N+1 blowups, unbounded retries,
 *   socket/stream teardown failures under sustained inserts).
 * - Correctness under that load: ClickHouse resolves EXACTLY the distinct members
 *   added (no lost/duplicated events), and the enriched read reports quantity = N.
 *
 * It intentionally uses a generous wall-clock budget: the goal is "not broken / not
 * pathologically slow in CI," not a strict production SLA (that belongs in the
 * opt-in load tests). The shared ClickHouse testcontainer is started once by
 * jestGlobalSetup; this file talks to it through the same singleton setup the other
 * Group suites use.
 */

const { describe, test, beforeAll, afterAll, expect } = require('@jest/globals');
const {
    setupGroupTests,
    teardownGroupTests,
    cleanupAllData,
    getSharedRequest,
    getClickHouseManager,
    getTestHeadersWithExternalStorage,
    syncClickHouseMaterializedViews
} = require('../../group/groupTestSetup');

describe('Group ClickHouse Performance Smoke', () => {
    // Small enough to run in CI in seconds, large enough to exercise bulk paths.
    // Well under the default PATCH operations limit (10000).
    const MEMBER_COUNT = 3000;

    // Generous CI budget - this is a smoke check, not a strict SLA.
    const MAX_LOAD_MS = 60000;

    beforeAll(async () => {
        await setupGroupTests();
        await cleanupAllData();
    });

    afterAll(async () => {
        await teardownGroupTests();
    });

    test(`bulk PATCH of ${MEMBER_COUNT} members loads and reads back correctly`, async () => {
        const request = getSharedRequest();
        const clickHouseManager = getClickHouseManager();

        const groupId = `perf-smoke-${Date.now()}`;

        // Create an empty Group on the ClickHouse-backed path.
        const createResponse = await request
            .post('/4_0_0/Group')
            .send({
                resourceType: 'Group',
                id: groupId,
                type: 'person',
                actual: true,
                member: [],
                meta: {
                    source: 'http://perf-smoke.com/Group',
                    security: [
                        { system: 'https://www.icanbwell.com/owner', code: 'perf-smoke-owner' },
                        { system: 'https://www.icanbwell.com/access', code: 'perf-smoke-access' }
                    ]
                }
            })
            .set(getTestHeadersWithExternalStorage());

        expect(createResponse.status).toBe(201);
        const actualId = createResponse.body.id;

        // One PATCH request appending MEMBER_COUNT distinct members (append-only events).
        const operations = Array.from({ length: MEMBER_COUNT }, (_, i) => ({
            op: 'add',
            path: '/member/-',
            value: { entity: { reference: `Patient/perf-smoke-${i}` } }
        }));

        const startTime = Date.now();
        const patchResponse = await request
            .patch(`/4_0_0/Group/${actualId}`)
            .send(operations)
            .set(getTestHeadersWithExternalStorage())
            .set('Content-Type', 'application/json-patch+json');
        const elapsedMs = Date.now() - startTime;

        expect(patchResponse.status).toBe(200);
        // Smoke budget: the bulk load must not hang / pathologically regress.
        expect(elapsedMs).toBeLessThan(MAX_LOAD_MS);

        // Force merges so the aggregated views see every appended event.
        await syncClickHouseMaterializedViews();

        // Correctness under load: exactly MEMBER_COUNT distinct active members.
        const activeCount = await clickHouseManager.queryAsync({
            query: `SELECT count() as count
                    FROM (
                        SELECT entity_reference
                        FROM fhir.Group_4_0_0_MemberEvents
                        WHERE group_id = {groupId:String}
                        GROUP BY entity_reference
                        HAVING argMax(event_type, (event_time, event_id)) = 'added'
                    )`,
            query_params: { groupId: actualId }
        });
        expect(parseInt(activeCount[0].count, 10)).toBe(MEMBER_COUNT);

        // End-to-end: the enriched read reports the full member count as quantity.
        const getResponse = await request
            .get(`/4_0_0/Group/${actualId}`)
            .set(getTestHeadersWithExternalStorage());

        expect(getResponse.status).toBe(200);
        expect(getResponse.body.resourceType).toBe('Group');
        expect(getResponse.body.quantity).toBe(MEMBER_COUNT);
    }, 120000);
});
