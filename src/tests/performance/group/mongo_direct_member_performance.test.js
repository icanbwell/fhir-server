/**
 * MongoDB Direct Group Member (V2) - PATCH Performance Testing
 *
 * Mirrors mongo_member_patch_performance.test.js but uses V2 direct storage.
 * Requires Docker MongoDB (`docker-compose up -d mongo`).
 *
 * Key difference from V1: no member validation, no event sourcing, no Patient stubs.
 * Expected to be faster due to simpler write path (upsert vs event append + ObjectId resolution).
 *
 * Tests:
 * 1. Operation limits: Find practical limits (100 -> 50K PATCH operations)
 * 2. Search performance at various Group sizes
 *
 * Verification queries hit Group_4_0_0_MemberDirect collection directly (no view).
 *
 * Run:
 *   docker-compose up -d mongo
 *   nvm use && node node_modules/.bin/jest src/tests/performance/group/mongo_direct_member_performance.test.js --testTimeout=600000
 */

process.env.ENABLE_MONGO_DIRECT_GROUP_MEMBERS = '1';
process.env.MONGO_DB_NAME = 'fhir_perf_test';
process.env.LOGLEVEL = 'SILENT';
process.env.STREAM_RESPONSE = '0';

const { describe, test, beforeAll, afterAll, expect } = require('@jest/globals');
const { commonBeforeEach, commonAfterEach, createTestRequest, getHeaders } = require('../../common');
const { ensureMongoDB } = require('../../ensureMongoDB');
const { COLLECTIONS } = require('../../../constants/mongoGroupMemberConstants');

describe('MongoDB Direct Member (V2) - PATCH Performance Testing', () => {
    let db;
    let request;

    beforeAll(async () => {
        await ensureMongoDB();
        await commonBeforeEach();

        request = await createTestRequest();

        const { createTestContainer } = require('../../createTestContainer');
        const container = createTestContainer();
        db = await container.mongoDatabaseManager.getClientDbAsync();

        // Create direct member collection + indexes
        const existingCollections = (await db.listCollections().toArray()).map(c => c.name);

        if (!existingCollections.includes(COLLECTIONS.GROUP_MEMBER_DIRECT)) {
            await db.createCollection(COLLECTIONS.GROUP_MEMBER_DIRECT);
        }

        const collection = db.collection(COLLECTIONS.GROUP_MEMBER_DIRECT);
        await collection.createIndex(
            { group_uuid: 1, member_reference: 1 },
            { name: 'groupUuid_memberReference', unique: true }
        );
        await collection.createIndex(
            { member_reference: 1, group_uuid: 1 },
            { name: 'memberReference_groupUuid' }
        );

        // V2: No Patient stubs needed (no member validation)
        console.log('V2 Direct: No Patient stubs needed (skipping validation)\n');
    }, 120000);

    afterAll(async () => {
        await commonAfterEach();
    }, 30000);

    function getTestHeaders() {
        return {
            ...getHeaders(),
            directGroupMemberRequest: 'true'
        };
    }

    /**
     * Prints storage stats for all collections used by the test
     */
    async function printStorageStats(label) {
        console.log(`\n========================================`);
        console.log(`Storage Stats: ${label}`);
        console.log(`========================================`);

        const collections = [COLLECTIONS.GROUP_MEMBER_DIRECT, 'Group_4_0_0'];
        for (const collName of collections) {
            try {
                const stats = await db.command({ collStats: collName });
                const indexDetails = Object.entries(stats.indexSizes || {})
                    .map(([name, size]) => `${name}: ${(size / 1024).toFixed(1)}KB`)
                    .join(', ');
                console.log(`  ${collName}:`);
                console.log(`    Documents: ${stats.count.toLocaleString()}`);
                console.log(`    Data size: ${(stats.size / 1024 / 1024).toFixed(2)}MB`);
                console.log(`    Storage size: ${(stats.storageSize / 1024 / 1024).toFixed(2)}MB`);
                console.log(`    Avg doc size: ${stats.avgObjSize || 0} bytes`);
                console.log(`    Total index size: ${(stats.totalIndexSize / 1024 / 1024).toFixed(2)}MB`);
                console.log(`    Indexes: ${indexDetails}`);
            } catch (e) {
                console.log(`  ${collName}: not found`);
            }
        }

        const dbStats = await db.command({ dbStats: 1 });
        console.log(`  Database total:`);
        console.log(`    Data size: ${(dbStats.dataSize / 1024 / 1024).toFixed(2)}MB`);
        console.log(`    Storage size: ${(dbStats.storageSize / 1024 / 1024).toFixed(2)}MB`);
        console.log(`    Index size: ${(dbStats.indexSize / 1024 / 1024).toFixed(2)}MB`);
        console.log(`========================================\n`);
    }

    /**
     * Helper: query direct collection to get active member count for a Group
     */
    async function getDirectMemberCount(groupUuid) {
        const collection = db.collection(COLLECTIONS.GROUP_MEMBER_DIRECT);
        return collection.countDocuments({
            group_uuid: groupUuid,
            inactive: { $ne: true }
        });
    }

    /**
     * Helper: get group _uuid from group id
     */
    async function getGroupUuid(groupId) {
        const groupDoc = await db.collection('Group_4_0_0').findOne(
            { id: groupId },
            { projection: { _uuid: 1 } }
        );
        return groupDoc?._uuid;
    }

    // ========== PATCH Operation Limits ==========

    describe('PATCH Operation Limits', () => {
        test('Find practical limit: 100, 1K, 5K, 10K, 25K, 50K operations', async () => {
            const testSizes = [100, 1000, 5000, 10000, 25000, 50000];
            const results = [];

            console.log('\n========================================');
            console.log('MongoDB Direct (V2) - PATCH Operations Limit');
            console.log('========================================\n');

            for (const numOps of testSizes) {
                const groupId = `patch-limit-direct-${numOps}-${Date.now()}`;

                // Create empty Group via POST
                const createResp = await request
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
                    .set(getTestHeaders());

                const actualGroupId = createResp.body.id;

                // Build PATCH operations with UUID references
                const operations = Array.from({ length: numOps }, (_, i) => {
                    // Generate deterministic UUID-like IDs
                    const hex = (i + 1).toString(16).padStart(12, '0');
                    const uuid = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4000-a000-${groupId.slice(-12).padStart(12, '0')}`;
                    return {
                        op: 'add',
                        path: '/member/-',
                        value: { entity: { reference: `Patient/${uuid}` } }
                    };
                });

                // Measure PATCH execution
                const startTime = Date.now();
                const memBefore = process.memoryUsage().heapUsed / 1024 / 1024;

                const patchResponse = await request
                    .patch(`/4_0_0/Group/${actualGroupId}`)
                    .set(getTestHeaders())
                    .set('Content-Type', 'application/json-patch+json')
                    .send(operations);

                const responseTime = Date.now() - startTime;
                const memAfter = process.memoryUsage().heapUsed / 1024 / 1024;
                const memUsed = memAfter - memBefore;

                // Verify via direct collection
                await new Promise(r => setTimeout(r, 200));
                const groupUuid = await getGroupUuid(actualGroupId);
                const verifiedCount = groupUuid ? await getDirectMemberCount(groupUuid) : 0;
                const verified = verifiedCount === numOps;
                const status = patchResponse.status;

                results.push({
                    numOps,
                    responseTime,
                    memUsed,
                    status,
                    verified
                });

                const passesThreshold = responseTime < 10000 && status === 200 && verified;

                console.log(`${numOps.toLocaleString()} operations:`);
                console.log(`  Response time: ${responseTime}ms ${passesThreshold ? 'PASS' : 'FAIL'}`);
                console.log(`  Memory used: ${memUsed.toFixed(2)}MB`);
                console.log(`  Status code: ${status}`);
                console.log(`  Direct collection verified: ${verified} (${verifiedCount} members)`);
                console.log(`  Passes threshold (<10s): ${passesThreshold}\n`);
            }

            await printStorageStats('PATCH Operation Limits');

            const passingTests = results.filter(r =>
                r.responseTime < 10000 && r.status === 200 && r.verified
            );
            const recommendedLimit = passingTests.length > 0
                ? passingTests[passingTests.length - 1].numOps
                : 1000;

            console.log('========================================');
            console.log('Recommendation');
            console.log('========================================');
            console.log(`Recommended MAX_PATCH_OPERATIONS: ${recommendedLimit.toLocaleString()}\n`);

            expect(results.length).toBe(testSizes.length);

        }, 600000);
    });

    // ========== Search Performance at Scale ==========

    describe('Search Performance', () => {
        test('Search by member at various Group sizes', async () => {
            const groupSizes = [100, 1000, 5000];
            const results = [];

            console.log('\n========================================');
            console.log('MongoDB Direct (V2) - Search Performance');
            console.log('========================================\n');

            for (const size of groupSizes) {
                const groupId = `search-perf-direct-${size}-${Date.now()}`;

                const createResp = await request
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
                    .set(getTestHeaders());

                const actualGroupId = createResp.body.id;

                // Add members via PATCH with UUID references
                const searchUuid1 = 'aaaa0000-0000-4000-a000-000000000001';
                const patchOps = Array.from({ length: size }, (_, i) => {
                    if (i === 0) {
                        return {
                            op: 'add',
                            path: '/member/-',
                            value: { entity: { reference: `Patient/${searchUuid1}` } }
                        };
                    }
                    const hex = (i + 1).toString(16).padStart(12, '0');
                    const uuid = `bbbb${hex.slice(0, 4)}-${hex.slice(4, 8)}-4000-a000-${hex}`;
                    return {
                        op: 'add',
                        path: '/member/-',
                        value: { entity: { reference: `Patient/${uuid}` } }
                    };
                });

                await request
                    .patch(`/4_0_0/Group/${actualGroupId}`)
                    .set(getTestHeaders())
                    .set('Content-Type', 'application/json-patch+json')
                    .send(patchOps);

                await new Promise(r => setTimeout(r, 200));

                // Search for the known member
                const searchStart = Date.now();
                const searchResponse = await request
                    .get(`/4_0_0/Group?member=Patient/${searchUuid1}`)
                    .set(getTestHeaders());
                const searchTime = Date.now() - searchStart;

                expect(searchResponse.status).toBe(200);
                const entries = searchResponse.body.entry || [];
                const found = entries.some(e => e.resource.id === actualGroupId);

                results.push({ size, searchTime, found });

                console.log(`Group with ${size.toLocaleString()} members:`);
                console.log(`  Search time: ${searchTime}ms`);
                console.log(`  Found group: ${found}\n`);
            }

            results.forEach(r => expect(r.found).toBe(true));

            console.log('========================================');
            console.log('Search Performance Summary');
            console.log('========================================');
            results.forEach(({ size, searchTime }) => {
                console.log(`  ${size.toLocaleString()} members: ${searchTime}ms`);
            });

            await printStorageStats('Search Performance');

        }, 600000);
    });

    // ========== 50K via Incremental PATCH ==========

    describe('50K via Incremental PATCH (5K x 10)', () => {
        test('Load 50K members in 10 batches of 5K', async () => {
            const groupId = `patch-50k-direct-${Date.now()}`;
            const BATCH_SIZE = 5000;
            const NUM_BATCHES = 10;
            const TOTAL = BATCH_SIZE * NUM_BATCHES;

            console.log('\n========================================');
            console.log('MongoDB Direct (V2) - 50K via PATCH (5K x 10)');
            console.log('========================================\n');

            const createResp = await request
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
                .set(getTestHeaders());

            const actualGroupId = createResp.body.id;
            const totalStart = Date.now();
            const batchTimes = [];

            for (let batch = 0; batch < NUM_BATCHES; batch++) {
                const startIdx = batch * BATCH_SIZE;
                const operations = Array.from({ length: BATCH_SIZE }, (_, i) => {
                    const num = startIdx + i + 1;
                    const padded = num.toString().padStart(12, '0');
                    const uuid = `cc000000-0000-4000-a000-${padded}`;
                    return {
                        op: 'add',
                        path: '/member/-',
                        value: { entity: { reference: `Patient/${uuid}` } }
                    };
                });

                const batchStart = Date.now();
                const resp = await request
                    .patch(`/4_0_0/Group/${actualGroupId}`)
                    .set(getTestHeaders())
                    .set('Content-Type', 'application/json-patch+json')
                    .send(operations);
                const batchTime = Date.now() - batchStart;
                batchTimes.push(batchTime);

                expect(resp.status).toBe(200);
                console.log(`  Batch ${batch + 1}/${NUM_BATCHES}: ${BATCH_SIZE} ops in ${batchTime}ms`);
            }

            const totalTime = Date.now() - totalStart;

            // Verify count
            await new Promise(r => setTimeout(r, 200));
            const groupUuid = await getGroupUuid(actualGroupId);
            const count = await getDirectMemberCount(groupUuid);

            console.log(`\n  Total: ${totalTime}ms for ${TOTAL.toLocaleString()} members`);
            console.log(`  Verified count: ${count.toLocaleString()}`);
            expect(count).toBe(TOTAL);

        }, 600000);
    });

    // ========== Member Count at Scale ==========

    describe('Member Count at Scale', () => {
        test('countDocuments at 10K, 50K', async () => {
            const scales = [10000, 50000];
            const results = [];

            console.log('\n========================================');
            console.log('MongoDB Direct (V2) - Member Count at Scale');
            console.log('========================================\n');

            for (const targetSize of scales) {
                const groupId = `count-perf-direct-${targetSize}-${Date.now()}`;

                const createResp = await request
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
                    .set(getTestHeaders());

                const actualGroupId = createResp.body.id;

                // Load members in 5K batches
                const BATCH = 5000;
                for (let offset = 0; offset < targetSize; offset += BATCH) {
                    const batchEnd = Math.min(offset + BATCH, targetSize);
                    const operations = Array.from({ length: batchEnd - offset }, (_, i) => {
                        const num = offset + i + 1;
                        const padded = num.toString().padStart(12, '0');
                        const uuid = `dd000000-0000-4000-${targetSize.toString(16).padStart(4, '0')}-${padded}`;
                        return {
                            op: 'add',
                            path: '/member/-',
                            value: { entity: { reference: `Patient/${uuid}` } }
                        };
                    });

                    await request
                        .patch(`/4_0_0/Group/${actualGroupId}`)
                        .set(getTestHeaders())
                        .set('Content-Type', 'application/json-patch+json')
                        .send(operations);
                }

                await new Promise(r => setTimeout(r, 200));

                // Measure count via API (GET with header triggers enrichment -> countDocuments)
                const groupUuid = await getGroupUuid(actualGroupId);
                const countStart = Date.now();
                const count = await getDirectMemberCount(groupUuid);
                const countTime = Date.now() - countStart;

                results.push({ scale: targetSize, countTime, count });

                console.log(`  ${targetSize.toLocaleString()} members: countDocuments in ${countTime}ms (verified: ${count.toLocaleString()})`);
                expect(count).toBe(targetSize);
            }

            console.log('\n  Summary:');
            results.forEach(({ scale, countTime }) => {
                console.log(`    ${scale.toLocaleString()} members: ${countTime}ms`);
            });

        }, 600000);
    });
});
