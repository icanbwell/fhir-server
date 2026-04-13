/**
 * MongoDB Direct Group Member (V2) - 1M Member Loading via PATCH
 *
 * Mirrors mongo_member_1m_patch.test.js but uses V2 direct storage.
 * Requires Docker MongoDB (`docker-compose up -d mongo`).
 *
 * Key difference from V1: no Patient stubs needed (no member validation),
 * no event collection (direct upsert), no view (direct countDocuments).
 *
 * Pattern:
 * - POST empty Group
 * - 100 PATCH requests x 10K operations each = 1M members
 * - Verification via direct collection countDocuments
 *
 * Run:
 *   docker-compose up -d mongo
 *   nvm use && node node_modules/.bin/jest src/tests/performance/group/mongo_direct_member_1m_patch.test.js --testTimeout=600000
 */

process.env.ENABLE_MONGO_DIRECT_GROUP_MEMBERS = '1';
process.env.MONGO_DB_NAME = 'fhir_perf_test';
process.env.LOGLEVEL = 'SILENT';
process.env.STREAM_RESPONSE = '0';

const { describe, test, beforeAll, afterAll, expect } = require('@jest/globals');
const { commonBeforeEach, commonAfterEach, createTestRequest, getHeaders } = require('../../common');
const { ensureMongoDB } = require('../../ensureMongoDB');
const { COLLECTIONS } = require('../../../constants/mongoGroupMemberConstants');

describe('MongoDB Direct Member (V2) - 1M PATCH Loading', () => {
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
    }, 120000);

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
                    .map(([name, size]) => {
                        if (size > 1024 * 1024) {
                            return `${name}: ${(size / 1024 / 1024).toFixed(2)}MB`;
                        }
                        return `${name}: ${(size / 1024).toFixed(1)}KB`;
                    })
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

    async function getDirectMemberCount(groupUuid) {
        const collection = db.collection(COLLECTIONS.GROUP_MEMBER_DIRECT);
        return collection.countDocuments({
            group_uuid: groupUuid,
            inactive: { $ne: true }
        });
    }

    async function getGroupUuid(groupId) {
        const groupDoc = await db.collection('Group_4_0_0').findOne(
            { id: groupId },
            { projection: { _uuid: 1 } }
        );
        return groupDoc?._uuid;
    }

    test('Load 1M members via PATCH (100 calls x 10K operations)', async () => {
        const groupId = `perf-1m-direct-${Date.now()}`;
        const OPERATIONS_PER_PATCH = 10000;
        const TARGET_MEMBERS = 1_000_000;
        const NUM_PATCHES = TARGET_MEMBERS / OPERATIONS_PER_PATCH; // 100

        console.log('\n========================================');
        console.log('1M Member Loading - MongoDB Direct (V2) PATCH');
        console.log('========================================');
        console.log(`Target: ${TARGET_MEMBERS.toLocaleString()} members`);
        console.log(`Operations per PATCH: ${OPERATIONS_PER_PATCH.toLocaleString()}`);
        console.log(`Total PATCH requests: ${NUM_PATCHES}`);
        console.log('Pattern: JSON Patch RFC 6902 with add /member/-\n');

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
            .set(getTestHeaders());

        expect(createResponse.status).toBe(201);

        const actualGroupId = createResponse.body.id;
        console.log(`Group created: ${actualGroupId}\n`);

        // Step 2: Load members via PATCH (UUID references)
        console.log('Step 2: Loading members via PATCH...\n');

        const patchTimes = [];
        let currentCount = 0;

        for (let batch = 1; batch <= NUM_PATCHES; batch++) {
            const startIndex = currentCount + 1;

            const operations = Array.from({ length: OPERATIONS_PER_PATCH }, (_, i) => {
                const num = startIndex + i;
                const hex = num.toString(16).padStart(12, '0');
                const uuid = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4000-a000-000000000000`;
                return {
                    op: 'add',
                    path: '/member/-',
                    value: { entity: { reference: `Patient/${uuid}` } }
                };
            });

            const startTime = Date.now();

            const patchResponse = await request
                .patch(`/4_0_0/Group/${actualGroupId}`)
                .send(operations)
                .set(getTestHeaders())
                .set('Content-Type', 'application/json-patch+json');

            let patchTime = Date.now() - startTime;
            patchTimes.push(patchTime);

            if (patchResponse.status !== 200) {
                // Retry once on transient failure
                console.warn(`Batch ${batch} failed (${patchResponse.status}), retrying after 3s...`);
                await new Promise(r => setTimeout(r, 3000));

                const retryResponse = await request
                    .patch(`/4_0_0/Group/${actualGroupId}`)
                    .send(operations)
                    .set(getTestHeaders())
                    .set('Content-Type', 'application/json-patch+json');

                patchTime = Date.now() - startTime;
                patchTimes[patchTimes.length - 1] = patchTime;

                if (retryResponse.status !== 200) {
                    console.error(`Batch ${batch} FAILED on retry with status ${retryResponse.status}:`);
                    console.error(JSON.stringify(retryResponse.body, null, 2).substring(0, 500));
                    expect(retryResponse.status).toBe(200);
                }
            }

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

        // Step 3: Verify final count via direct collection
        console.log('\n========================================');
        console.log('Verification: Direct Collection countDocuments');
        console.log('========================================\n');

        await new Promise(r => setTimeout(r, 2000));

        const groupUuid = await getGroupUuid(actualGroupId);
        const queryStart = Date.now();
        const finalCount = await getDirectMemberCount(groupUuid);
        const queryTime = Date.now() - queryStart;

        console.log(`countDocuments time: ${queryTime}ms`);
        console.log(`Final member count: ${finalCount.toLocaleString()}\n`);
        expect(finalCount).toBe(TARGET_MEMBERS);

        // Step 4: Search performance at 1M
        console.log('========================================');
        console.log('Search at 1M scale');
        console.log('========================================\n');

        const searchUuid = '00000001-0000-4000-a000-000000000000'; // First member
        const searchStart = Date.now();
        const searchResponse = await request
            .get(`/4_0_0/Group?member=Patient/${searchUuid}`)
            .set(getTestHeaders());
        const searchTime = Date.now() - searchStart;

        console.log(`Search time (1M members): ${searchTime}ms`);
        console.log(`Status: ${searchResponse.status}`);
        const entries = searchResponse.body.entry || [];
        console.log(`Found: ${entries.length} group(s)\n`);

        // Step 5: Performance summary
        const totalTime = patchTimes.reduce((a, b) => a + b, 0);
        const avgPatchTime = Math.round(totalTime / patchTimes.length);
        const avgPerMember = (totalTime / TARGET_MEMBERS).toFixed(2);
        const minBatch = Math.min(...patchTimes);
        const maxBatch = Math.max(...patchTimes);

        console.log('========================================');
        console.log('Performance Summary');
        console.log('========================================');
        console.log(`Total write time: ${(totalTime / 1000).toFixed(2)}s`);
        console.log(`Average PATCH time: ${avgPatchTime}ms`);
        console.log(`Min batch time: ${minBatch}ms`);
        console.log(`Max batch time: ${maxBatch}ms`);
        console.log(`Average per member: ${avgPerMember}ms`);
        console.log(`Throughput: ${Math.round(TARGET_MEMBERS / (totalTime / 1000))} members/second`);
        console.log(`Count query time (1M): ${queryTime}ms`);
        console.log(`Search query time (1M): ${searchTime}ms`);

        await printStorageStats('1M PATCH Loading');

    }, 600000); // 10 minute timeout
});
