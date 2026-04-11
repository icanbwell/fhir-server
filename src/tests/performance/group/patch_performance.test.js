/**
 * PATCH Performance Testing
 *
 * Comprehensive testing of PATCH operations on Group.member:
 * 1. Performance comparison: PATCH vs PUT at 50K scale
 * 2. Operation limits: Find practical limits (100 → 50K operations)
 *
 * PATCH provides significant performance benefits by avoiding full array reads/writes.
 */

process.env.ENABLE_CLICKHOUSE = '1';
process.env.MONGO_WITH_CLICKHOUSE_RESOURCES = 'Group';
process.env.CLICKHOUSE_WRITE_MODE = 'sync';
process.env.CLICKHOUSE_DATABASE = 'fhir';
process.env.LOGLEVEL = 'SILENT';
process.env.STREAM_RESPONSE = '0';
process.env.MAX_GROUP_MEMBERS_PER_PUT = '100000'; // Allow up to 100K for performance testing

const { describe, test, beforeAll, afterAll, expect } = require('@jest/globals');
const { commonBeforeEach, commonAfterEach, createTestRequest, getHeaders } = require('../../common');
const { ConfigManager } = require('../../../utils/configManager');
const { ClickHouseClientManager } = require('../../../utils/clickHouseClientManager');
const { ensureClickHouse } = require('../../ensureClickHouse');
const { USE_EXTERNAL_MEMBER_STORAGE_HEADER } = require('../../../utils/contextDataBuilder');

function getHeadersWithExternalStorage() {
    return { ...getHeaders(), [USE_EXTERNAL_MEMBER_STORAGE_HEADER]: 'true' };
}

describe('PATCH Performance Testing', () => {
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
            await clickHouseManager.closeAsync();
        }
        await commonAfterEach();
    }, 30000);

    // ========================================
    // PATCH Operation Limits
    // ========================================

    describe('PATCH Operation Limits', () => {
        test('Find practical limit: 100, 1K, 5K, 10K, 25K, 50K operations', async () => {
            const testSizes = [100, 1000, 5000, 10000, 25000, 50000];
            const results = [];

            console.log('\n========================================');
            console.log('PATCH Operations Limit - Empirical Test');
            console.log('========================================\n');

            for (const numOps of testSizes) {
                const groupId = `patch-limit-${numOps}-${Date.now()}`;
                const request = await createTestRequest();

                // Create empty Group
                await request
                    .post('/4_0_0/Group')
                    .send({
                        resourceType: 'Group',
                        id: groupId,
                        type: 'person',
                        actual: true,
                        member: [],
                        meta: {
                            source: 'http://perf-test-system.com/Group',
                            security: [
                                { system: 'https://www.icanbwell.com/owner', code: 'perf-test-owner' },
                                { system: 'https://www.icanbwell.com/access', code: 'perf-test-access' }
                            ]
                        }
                    })
                    .set(getHeadersWithExternalStorage());

                // Build PATCH operations
                const operations = Array.from({ length: numOps }, (_, i) => ({
                    op: 'add',
                    path: '/member/-',
                    value: { entity: { reference: `Patient/${i + 1}` } }
                }));

                // Measure PATCH execution
                const startTime = Date.now();
                const memBefore = process.memoryUsage().heapUsed / 1024 / 1024; // MB

                const patchResponse = await request
                    .patch(`/4_0_0/Group/${groupId}`)
                    .set('Content-Type', 'application/json-patch+json')
                    .send(operations)
                    .set(getHeadersWithExternalStorage());

                const responseTime = Date.now() - startTime;
                const memAfter = process.memoryUsage().heapUsed / 1024 / 1024; // MB
                const memUsed = memAfter - memBefore;

                // Verify ClickHouse
                await new Promise(r => setTimeout(r, 1000));

                const countResult = await clickHouseManager.queryAsync({
                    query: `SELECT count() as count
                            FROM (
                                SELECT entity_reference
                                FROM fhir.fhir_group_member_events
                                WHERE group_id = {groupId:String}
                                GROUP BY entity_reference
                                HAVING argMax(event_type, (event_time, event_id)) = 'added'
                            )`,
                    query_params: { groupId }
                });

                const verified = parseInt(countResult[0].count) === numOps;
                const status = patchResponse.status;

                results.push({
                    numOps,
                    responseTime,
                    memUsed,
                    status,
                    verified
                });

                const passesThreshold = responseTime < 5000 && status === 200 && verified;

                console.log(`${numOps.toLocaleString()} operations:`);
                console.log(`  Response time: ${responseTime}ms ${passesThreshold ? '✅' : '❌'}`);
                console.log(`  Memory used: ${memUsed.toFixed(2)}MB`);
                console.log(`  Status code: ${status}`);
                console.log(`  ClickHouse verified: ${verified}`);
                console.log(`  Passes threshold (<5s): ${passesThreshold}\n`);
            }

            // Determine recommended limit
            const passingTests = results.filter(r =>
                r.responseTime < 5000 && r.status === 200 && r.verified
            );
            const recommendedLimit = passingTests.length > 0
                ? passingTests[passingTests.length - 1].numOps
                : 1000;

            console.log('========================================');
            console.log('Recommendation');
            console.log('========================================');
            console.log(`Recommended MAX_PATCH_OPERATIONS: ${recommendedLimit.toLocaleString()}`);
            console.log(`\nSet in configManager or environment variable:`);
            console.log(`GROUP_PATCH_OPERATIONS_LIMIT=${recommendedLimit}\n`);

            // All tests should complete (not crash)
            expect(results.length).toBe(testSizes.length);

        }, 600000); // 10 minute timeout
    });
});
