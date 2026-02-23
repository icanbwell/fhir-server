/**
 * Incremental Loading Test - FHIR R4B Patterns
 *
 * Demonstrates two patterns for loading members incrementally:
 *
 * 1. PUT pattern (FHIR R4B compliant):
 *    - POST with initial batch
 *    - PUT with incremental additions (each PUT sends FULL member array)
 *    - Limited by MAX_GROUP_MEMBERS_PER_PUT (default: 50K members)
 *    - Test uses 10K scale (well within default limit)
 *
 * 2. PATCH pattern (RECOMMENDED for large scales):
 *    - POST with initial batch
 *    - PATCH operations send only NEW members (efficient)
 *    - No member count limit (appends events, not full arrays)
 *    - Test uses 50K scale to demonstrate scalability
 *
 * PATCH is the recommended pattern for production use with large Groups.
 */

process.env.ENABLE_CLICKHOUSE = '1';
process.env.MONGO_WITH_CLICKHOUSE_RESOURCES = 'Group';
process.env.CLICKHOUSE_WRITE_MODE = 'sync';
process.env.CLICKHOUSE_DATABASE = 'fhir';
process.env.LOGLEVEL = 'ERROR'; // Reduce log spam
process.env.STREAM_RESPONSE = '0';
// MAX_GROUP_MEMBERS_PER_PUT defaults to 50000 - tests respect this limit
// For larger scales, use PATCH (see test below)

const { describe, test, beforeAll, afterAll, expect } = require('@jest/globals');
const { commonBeforeEach, commonAfterEach, createTestRequest, getHeaders } = require('../../common');
const { ConfigManager } = require('../../../utils/configManager');
const { ClickHouseClientManager } = require('../../../utils/clickHouseClientManager');
const { ensureClickHouse } = require('../../ensureClickHouse');

describe('Incremental Loading - FHIR R4B Compliant Pattern', () => {
    let clickHouseManager;

    beforeAll(async () => {
        await ensureClickHouse();
        await commonBeforeEach();

        const configManager = new ConfigManager();
        clickHouseManager = new ClickHouseClientManager({ configManager });
        await clickHouseManager.getClientAsync();
    }, 120000);

    afterAll(async () => {
        if (clickHouseManager) {
            try {
                await clickHouseManager.truncateTableAsync('fhir_group_member_current_by_entity');
                await clickHouseManager.truncateTableAsync('fhir_group_member_current');
                await clickHouseManager.truncateTableAsync('fhir_group_member_events');

                const { createTestContainer } = require('../../createTestContainer');
                const container = createTestContainer();
                if (container && container.mongoClient) {
                    const db = container.mongoClient.db(container.configManager.mongoDbName);
                    await db.collection('Group_4_0_0').deleteMany({});
                }
            } catch (e) {
                console.warn('Cleanup warning:', e.message);
            }

            await clickHouseManager.closeAsync();
        }
        await commonAfterEach();
    }, 30000);

    /**
     * PUT-based incremental loading test
     * Note: Limited to 10K scale due to HTTP payload size constraints in test environment
     * For larger scales, use PATCH (see separate test below)
     */
    test.each([
        [10000, 1000, 10, '10K']   // 10K members, 1K batch size, 10 batches
    ])('Load %s members incrementally (%s per batch, PUT pattern)', async (TARGET_MEMBERS, BATCH_SIZE, NUM_BATCHES, label) => {
        const groupId = `perf-${label}-${Date.now()}`;

        console.log('\n========================================');
        console.log(`FHIR R4B Incremental Loading - ${label} Scale`);
        console.log('========================================');
        console.log(`Target: ${TARGET_MEMBERS.toLocaleString()} members`);
        console.log(`Batch size: ${BATCH_SIZE.toLocaleString()}`);
        console.log(`Total operations: 1 POST + ${NUM_BATCHES - 1} PUTs = ${NUM_BATCHES}`);
        console.log('Pattern: Each PUT sends FULL member array (FHIR R4B requirement)\n');

        const request = await createTestRequest();
        const batchTimes = [];
        const milestones = TARGET_MEMBERS === 50000 ? [10000, 25000, 50000] : [2000, 5000, 10000];

        // Batch 1: POST with initial batch
        console.log(`Batch 1/${NUM_BATCHES}: POST with ${BATCH_SIZE.toLocaleString()} initial members...`);
        let allMembers = Array.from({ length: BATCH_SIZE }, (_, i) => ({
            entity: { reference: `Patient/${i + 1}` }
        }));

        let startTime = Date.now();
        const createResponse = await request
            .post('/4_0_0/Group')
            .send({
                resourceType: 'Group',
                id: groupId,
                type: 'person',
                actual: true,
                name: `Performance Test Group ${groupId}`,
                member: allMembers,
                meta: {
                    source: 'http://perf-test-system.com/Group',
                    security: [
                        { system: 'https://www.icanbwell.com/owner', code: 'perf-test-owner' },
                        { system: 'https://www.icanbwell.com/access', code: 'perf-test-access' }
                    ]
                }
            })
            .set(getHeaders());

        let batchTime = Date.now() - startTime;
        batchTimes.push(batchTime);

        expect(createResponse.status).toBe(201);

        // Use the actual ID from the response (server may generate UUID)
        const actualGroupId = createResponse.body.id;
        console.log(`  ✅ Created in ${batchTime}ms (${(batchTime / BATCH_SIZE).toFixed(2)}ms/member)\n`);

        // Wait for ClickHouse sync
        await new Promise(r => setTimeout(r, 2000));

        // Verify ClickHouse has events
        const eventCount = await clickHouseManager.queryAsync({
            query: `SELECT count(*) as count FROM fhir.fhir_group_member_events WHERE group_id = {groupId:String}`,
            query_params: { groupId: actualGroupId }
        });
        console.log(`  ClickHouse: ${parseInt(eventCount[0].count).toLocaleString()} events written\n`);
        expect(parseInt(eventCount[0].count)).toBe(BATCH_SIZE);

        // Remaining batches: PUT with incrementally larger member arrays
        let currentCount = BATCH_SIZE;
        const milestoneQueryTimes = [];

        for (let batch = 2; batch <= NUM_BATCHES; batch++) {
            const totalMembers = batch * BATCH_SIZE;

            console.log(`Batch ${batch}/${NUM_BATCHES}: PUT with ${totalMembers.toLocaleString()} members (adding ${BATCH_SIZE.toLocaleString()} more)...`);

            // Append new batch to existing array (real clients would load + append, not recreate)
            const newBatchStart = allMembers.length + 1;
            for (let i = 0; i < BATCH_SIZE; i++) {
                allMembers.push({
                    entity: { reference: `Patient/${newBatchStart + i}` }
                });
            }

            startTime = Date.now();
            const updateResponse = await request
                .put(`/4_0_0/Group/${actualGroupId}`)
                .send({
                    resourceType: 'Group',
                    id: actualGroupId,
                    type: 'person',
                    actual: true,
                    name: `Performance Test Group ${actualGroupId}`,
                    member: allMembers,
                    meta: {
                        source: 'http://perf-test-system.com/Group',
                        security: [
                            { system: 'https://www.icanbwell.com/owner', code: 'perf-test-owner' },
                            { system: 'https://www.icanbwell.com/access', code: 'perf-test-access' }
                        ],
                        versionId: createResponse.body.meta.versionId,
                        lastUpdated: createResponse.body.meta.lastUpdated
                    }
                })
                .set(getHeaders());

            batchTime = Date.now() - startTime;
            batchTimes.push(batchTime);

            expect([200, 201]).toContain(updateResponse.status);
            console.log(`  ✅ Updated in ${batchTime}ms (${(batchTime / BATCH_SIZE).toFixed(2)}ms/member added)`);
            console.log(`     Request payload: ${(JSON.stringify(allMembers).length / 1024 / 1024).toFixed(2)}MB`);

            currentCount = totalMembers;

            // Verify argMax query performance at milestones
            if (milestones.includes(currentCount)) {
                await new Promise(r => setTimeout(r, 1000));

                const queryStart = Date.now();
                const countResult = await clickHouseManager.queryAsync({
                    query: `SELECT count() as count
                            FROM (
                                SELECT entity_reference
                                FROM fhir.fhir_group_member_events
                                WHERE group_id = {groupId:String}
                                GROUP BY entity_reference
                                HAVING argMax(event_type, (event_time, event_id)) = 'added'
                            )`,
                    query_params: { groupId: actualGroupId }
                });
                const queryTime = Date.now() - queryStart;
                milestoneQueryTimes.push({ milestone: currentCount, queryTime });

                const verifiedCount = parseInt(countResult[0].count);
                console.log(`  🔍 Milestone ${(currentCount / 1000)}K: argMax query ${queryTime}ms, verified ${verifiedCount.toLocaleString()} members`);
                expect(verifiedCount).toBe(currentCount);
            } else {
                // Brief pause for ClickHouse sync
                await new Promise(r => setTimeout(r, 1000));
            }
        }

        // Final verification
        console.log('\n========================================');
        console.log('Verification: argMax query for final count');
        console.log('========================================\n');

        const queryStart = Date.now();
        const countResult = await clickHouseManager.queryAsync({
            query: `SELECT count() as count
                    FROM (
                        SELECT entity_reference
                        FROM fhir.fhir_group_member_events
                        WHERE group_id = {groupId:String}
                        GROUP BY entity_reference
                        HAVING argMax(event_type, (event_time, event_id)) = 'added'
                    )`,
            query_params: { groupId: actualGroupId }
        });
        const queryTime = Date.now() - queryStart;

        const finalCount = parseInt(countResult[0].count);
        console.log(`argMax query time: ${queryTime}ms`);
        console.log(`Final member count: ${finalCount.toLocaleString()}\n`);
        expect(finalCount).toBe(TARGET_MEMBERS);

        // Performance summary
        const totalTime = batchTimes.reduce((a, b) => a + b, 0);
        const avgBatchTime = Math.round(totalTime / batchTimes.length);
        const avgPerMember = (totalTime / TARGET_MEMBERS).toFixed(2);

        console.log('========================================');
        console.log('Performance Summary');
        console.log('========================================');
        console.log(`Total time: ${(totalTime / 1000).toFixed(2)}s (${(totalTime / 60000).toFixed(1)} minutes)`);
        console.log(`Average batch time: ${avgBatchTime}ms`);
        console.log(`Average per member: ${avgPerMember}ms`);
        console.log(`Throughput: ${Math.round(TARGET_MEMBERS / (totalTime / 1000))} members/second`);

        if (milestoneQueryTimes.length > 0) {
            console.log('\nargMax Query Performance at Milestones:');
            milestoneQueryTimes.forEach(({ milestone, queryTime }) => {
                console.log(`  • ${(milestone / 1000).toLocaleString()}K members: ${queryTime}ms`);
            });
            const avgQueryTime = Math.round(milestoneQueryTimes.reduce((sum, m) => sum + m.queryTime, 0) / milestoneQueryTimes.length);
            console.log(`  Average: ${avgQueryTime}ms (remains consistent across scale)`);
        }

        console.log(`\n✅ Successfully loaded ${TARGET_MEMBERS.toLocaleString()} members using FHIR R4B compliant pattern`);
        console.log('✅ Each PUT sent complete member array (FHIR requirement)');
        console.log('✅ ClickHouse handled diff computation and event storage');
        console.log('✅ argMax query verified final state\n');

    }, 600000); // 10 minute timeout

    /**
     * PATCH-based incremental loading (RECOMMENDED pattern for large scales)
     * More efficient than PUT - only sends deltas, not full array
     *
     * This is the realistic client pattern:
     * - No memory issues with large Groups (only sends deltas)
     * - Network efficient (smaller payloads)
     * - Scales to 100K+ members without problems
     */
    test('Load 50K members incrementally using PATCH (recommended pattern)', async () => {
        const TARGET_MEMBERS = 50000;
        const BATCH_SIZE = 5000; // 5K per PATCH (under 10K limit, efficient)
        const NUM_BATCHES = 10; // 1 POST + 9 PATCHes
        const groupId = `perf-patch-50k-${Date.now()}`;

        console.log('\n========================================');
        console.log('PATCH-Based Incremental Loading - 50K Scale');
        console.log('========================================');
        console.log(`Target: ${TARGET_MEMBERS.toLocaleString()} members`);
        console.log(`Batch size: ${BATCH_SIZE.toLocaleString()} per PATCH`);
        console.log(`Total operations: 1 POST + ${NUM_BATCHES - 1} PATCHes = ${NUM_BATCHES}`);
        console.log('Pattern: Each PATCH sends only NEW members (efficient)\n');

        const request = await createTestRequest();
        const batchTimes = [];

        // Batch 1: POST with initial batch
        console.log(`Batch 1/${NUM_BATCHES}: POST with ${BATCH_SIZE.toLocaleString()} initial members...`);
        const initialMembers = Array.from({ length: BATCH_SIZE }, (_, i) => ({
            entity: { reference: `Patient/patch-${i + 1}` }
        }));

        let startTime = Date.now();
        const createResponse = await request
            .post('/4_0_0/Group')
            .send({
                resourceType: 'Group',
                id: groupId,
                type: 'person',
                actual: true,
                name: `PATCH Performance Test Group ${groupId}`,
                member: initialMembers,
                meta: {
                    source: 'http://perf-test-system.com/Group',
                    security: [
                        { system: 'https://www.icanbwell.com/owner', code: 'perf-test-owner' },
                        { system: 'https://www.icanbwell.com/access', code: 'perf-test-access' }
                    ]
                }
            })
            .set(getHeaders());

        let batchTime = Date.now() - startTime;
        batchTimes.push(batchTime);
        expect(createResponse.status).toBe(201);

        const actualGroupId = createResponse.body.id;
        console.log(`  ✅ Created in ${batchTime}ms (${(batchTime / BATCH_SIZE).toFixed(2)}ms/member)\n`);

        await new Promise(r => setTimeout(r, 1000));

        // Remaining batches: PATCH with only NEW members (efficient)
        let currentCount = BATCH_SIZE;

        for (let batch = 2; batch <= NUM_BATCHES; batch++) {
            const newBatchStart = currentCount + 1;
            const newBatchEnd = batch * BATCH_SIZE;

            console.log(`Batch ${batch}/${NUM_BATCHES}: PATCH adding ${BATCH_SIZE.toLocaleString()} members (${newBatchStart} to ${newBatchEnd})...`);

            // Build PATCH operations - only send NEW members
            const patchOps = [];
            for (let i = newBatchStart; i <= newBatchEnd; i++) {
                patchOps.push({
                    op: 'add',
                    path: '/member/-',
                    value: { entity: { reference: `Patient/patch-${i}` } }
                });
            }

            startTime = Date.now();
            const patchResponse = await request
                .patch(`/4_0_0/Group/${actualGroupId}`)
                .send(patchOps)
                .set(getHeaders())
                .set('Content-Type', 'application/json-patch+json');

            batchTime = Date.now() - startTime;
            batchTimes.push(batchTime);

            expect(patchResponse.status).toBe(200);
            console.log(`  ✅ Patched in ${batchTime}ms (${(batchTime / BATCH_SIZE).toFixed(2)}ms/member added)`);
            console.log(`     Request payload: ${(JSON.stringify(patchOps).length / 1024).toFixed(2)}KB (vs ${(BATCH_SIZE * 50 / 1024).toFixed(2)}KB for full array)`);

            currentCount = newBatchEnd;
            await new Promise(r => setTimeout(r, 500));
        }

        // Final verification
        console.log('\n========================================');
        console.log('Verification: argMax query for final count');
        console.log('========================================\n');

        await new Promise(r => setTimeout(r, 2000));

        const queryStart = Date.now();
        const countResult = await clickHouseManager.queryAsync({
            query: `SELECT count() as count
                    FROM (
                        SELECT entity_reference
                        FROM fhir.fhir_group_member_events
                        WHERE group_id = {groupId:String}
                        GROUP BY entity_reference
                        HAVING argMax(event_type, (event_time, event_id)) = 'added'
                    )`,
            query_params: { groupId: actualGroupId }
        });
        const queryTime = Date.now() - queryStart;

        const finalCount = parseInt(countResult[0].count);
        console.log(`argMax query time: ${queryTime}ms`);
        console.log(`Final member count: ${finalCount.toLocaleString()}\n`);
        expect(finalCount).toBe(TARGET_MEMBERS);

        // Performance summary
        const totalTime = batchTimes.reduce((a, b) => a + b, 0);
        const avgBatchTime = Math.round(totalTime / batchTimes.length);
        const avgPerMember = (totalTime / TARGET_MEMBERS).toFixed(2);

        console.log('========================================');
        console.log('Performance Summary');
        console.log('========================================');
        console.log(`Total time: ${(totalTime / 1000).toFixed(2)}s`);
        console.log(`Average batch time: ${avgBatchTime}ms`);
        console.log(`Average per member: ${avgPerMember}ms`);
        console.log(`Throughput: ${Math.round(TARGET_MEMBERS / (totalTime / 1000))} members/second`);

        console.log(`\n✅ Successfully loaded ${TARGET_MEMBERS.toLocaleString()} members using PATCH (realistic pattern)`);
        console.log('✅ Each PATCH sent only NEW members (efficient)');
        console.log('✅ ClickHouse handled event storage');
        console.log('✅ argMax query verified final state\n');

    }, 600000); // 10 minute timeout
});
