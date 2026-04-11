/**
 * 1M Member Loading - FHIR R4B PATCH Pattern
 *
 * Demonstrates the correct FHIR R4B compliant pattern for loading 1M members incrementally:
 * - POST empty Group
 * - PATCH with JSON Patch operations (RFC 6902)
 * - Each PATCH contains up to 10K "add /member/-" operations
 * - 100 PATCH requests total for 1M members
 *
 * This is the sanctioned FHIR R4B pattern - no custom operations, fully compliant.
 */

process.env.ENABLE_CLICKHOUSE = '1';
process.env.MONGO_WITH_CLICKHOUSE_RESOURCES = 'Group';
process.env.CLICKHOUSE_WRITE_MODE = 'sync';
process.env.CLICKHOUSE_DATABASE = 'fhir';
process.env.LOGLEVEL = 'SILENT';
process.env.STREAM_RESPONSE = '0';
process.env.MAX_GROUP_MEMBERS_PER_PUT = '10000'; // PATCH operations add incrementally, so small batches only

const { describe, test, beforeAll, afterAll, expect } = require('@jest/globals');
const { commonBeforeEach, commonAfterEach, createTestRequest, getHeaders } = require('../../common');
const { ConfigManager } = require('../../../utils/configManager');
const { ClickHouseClientManager } = require('../../../utils/clickHouseClientManager');
const { ClickHouseTestContainer } = require('../../clickHouseTestContainer');

const clickHouseTestContainer = new ClickHouseTestContainer();

describe('1M Member Loading - FHIR R4B PATCH Pattern', () => {
    let clickHouseManager;

    beforeAll(async () => {
        await clickHouseTestContainer.start();
        clickHouseTestContainer.applyEnvVars();
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

    test('Load 1M members via PATCH (100 calls × 10K operations)', async () => {
        const groupId = `perf-1m-patch-${Date.now()}`;
        const OPERATIONS_PER_PATCH = 10000; // Based on empirical testing
        const TARGET_MEMBERS = 1_000_000;
        const NUM_PATCHES = TARGET_MEMBERS / OPERATIONS_PER_PATCH; // 100

        console.log('\n========================================');
        console.log('1M Member Loading - FHIR R4B PATCH');
        console.log('========================================');
        console.log(`Target: ${TARGET_MEMBERS.toLocaleString()} members`);
        console.log(`Operations per PATCH: ${OPERATIONS_PER_PATCH.toLocaleString()}`);
        console.log(`Total PATCH requests: ${NUM_PATCHES}`);
        console.log('Pattern: JSON Patch RFC 6902 with add /member/-\n');

        const request = await createTestRequest();

        // Step 1: Create empty Group
        console.log('Step 1: Creating empty Group...');
        const createResponse = await request
            .post('/4_0_0/Group')
            .send({
                resourceType: 'Group',
                id: groupId,
                type: 'person',
                actual: true,
                name: `Performance Test Group ${groupId}`,
                member: [],
                meta: {
                    source: 'http://perf-test-system.com/Group',
                    security: [
                        { system: 'https://www.icanbwell.com/owner', code: 'perf-test-owner' },
                        { system: 'https://www.icanbwell.com/access', code: 'perf-test-access' }
                    ]
                }
            })
            .set(getHeaders());

        expect(createResponse.status).toBe(201);

        // Use the actual ID from the response
        const actualGroupId = createResponse.body.id;
        console.log(`✅ Group created: ${actualGroupId}\n`);

        // Step 2: Load members via PATCH
        console.log('Step 2: Loading members via PATCH...\n');

        const patchTimes = [];
        let currentCount = 0;

        for (let batch = 1; batch <= NUM_PATCHES; batch++) {
            const startIndex = currentCount + 1;

            // Build JSON Patch operations
            const operations = Array.from({ length: OPERATIONS_PER_PATCH }, (_, i) => ({
                op: 'add',
                path: '/member/-',
                value: { entity: { reference: `Patient/${startIndex + i}` } }
            }));

            const startTime = Date.now();

            const patchResponse = await request
                .patch(`/4_0_0/Group/${actualGroupId}`)
                .send(operations)
                .set(getHeaders())
                .set('Content-Type', 'application/json-patch+json'); // Must be AFTER getHeaders() to avoid overwrite

            const patchTime = Date.now() - startTime;
            patchTimes.push(patchTime);

            expect(patchResponse.status).toBe(200);

            currentCount += OPERATIONS_PER_PATCH;

            console.log(
                `Batch ${batch}/${NUM_PATCHES}: ` +
                `Added ${OPERATIONS_PER_PATCH.toLocaleString()} members ` +
                `(total: ${currentCount.toLocaleString()}) ` +
                `in ${patchTime}ms ` +
                `(${(patchTime / OPERATIONS_PER_PATCH).toFixed(2)}ms/member)`
            );

            // Brief pause every 10 batches
            if (batch % 10 === 0) {
                await new Promise(r => setTimeout(r, 1000));
            }
        }

        // Step 3: Verify final count with argMax
        console.log('\n========================================');
        console.log('Verification: argMax Query');
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

        // Step 4: Performance summary
        const totalTime = patchTimes.reduce((a, b) => a + b, 0);
        const avgPatchTime = Math.round(totalTime / patchTimes.length);
        const avgPerMember = (totalTime / TARGET_MEMBERS).toFixed(2);

        console.log('========================================');
        console.log('Performance Summary');
        console.log('========================================');
        console.log(`Total time: ${(totalTime / 1000).toFixed(2)}s`);
        console.log(`Average PATCH time: ${avgPatchTime}ms`);
        console.log(`Average per member: ${avgPerMember}ms`);
        console.log(`Throughput: ${Math.round(TARGET_MEMBERS / (totalTime / 1000))} members/second`);
        console.log(`Payload size per PATCH: ~${((OPERATIONS_PER_PATCH * 50) / 1024).toFixed(0)}KB`);
        console.log('\n✅ Successfully loaded 1M members using FHIR R4B PATCH');
        console.log('✅ Pure append operations (no reads, no diffs)');
        console.log('✅ Constant payload size per PATCH');
        console.log('✅ argMax verified deterministic final state\n');

    }, 600000); // 10 minute timeout
});
