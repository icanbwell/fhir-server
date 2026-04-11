/**
 * MongoDB Group Member - 1M Member Loading via PATCH
 *
 * Mirrors incremental_loading_1m_patch.test.js (ClickHouse) but uses MongoDB
 * member storage. Requires Docker MongoDB (`docker-compose up -d mongo`).
 *
 * Pattern:
 * - POST empty Group
 * - 100 PATCH requests × 10K operations each = 1M members
 * - Verification via MongoDB view (Group_4_0_0_MemberCurrent)
 *
 * Run:
 *   docker-compose up -d mongo
 *   nvm use && node node_modules/.bin/jest src/tests/performance/group/mongo_member_1m_patch.test.js
 */

process.env.ENABLE_MONGO_GROUP_MEMBERS = '1';
process.env.MONGO_DB_NAME = 'fhir_perf_test';
process.env.LOGLEVEL = 'SILENT';
process.env.STREAM_RESPONSE = '0';

const { describe, test, beforeAll, afterAll, expect } = require('@jest/globals');
const { commonBeforeEach, commonAfterEach, createTestRequest, getHeaders } = require('../../common');
const { ensureMongoDB } = require('../../ensureMongoDB');
const { COLLECTIONS } = require('../../../constants/mongoGroupMemberConstants');
const { generateUUIDv5 } = require('../../../utils/uid.util');

describe('MongoDB Member - 1M PATCH Loading', () => {
    let db;
    let request;

    beforeAll(async () => {
        await ensureMongoDB();
        await commonBeforeEach();

        request = await createTestRequest();

        const { createTestContainer } = require('../../createTestContainer');
        const container = createTestContainer();
        db = await container.mongoDatabaseManager.getClientDbAsync();

        // Create event collection + view
        const existingCollections = (await db.listCollections().toArray()).map(c => c.name);

        if (!existingCollections.includes(COLLECTIONS.GROUP_MEMBER_EVENTS)) {
            await db.createCollection(COLLECTIONS.GROUP_MEMBER_EVENTS);
        }

        if (!existingCollections.includes(COLLECTIONS.GROUP_MEMBER_CURRENT)) {
            await db.command({
                create: COLLECTIONS.GROUP_MEMBER_CURRENT,
                viewOn: COLLECTIONS.GROUP_MEMBER_EVENTS,
                pipeline: [
                    { $sort: { group_id: 1, member_type: 1, member_object_id: 1, _id: -1 } },
                    {
                        $group: {
                            _id: {
                                group_id: '$group_id',
                                member_type: '$member_type',
                                member_object_id: '$member_object_id'
                            },
                            group_id: { $first: '$group_id' },
                            group_uuid: { $first: '$group_uuid' },
                            member_type: { $first: '$member_type' },
                            member_object_id: { $first: '$member_object_id' },
                            entity: { $first: '$entity' },
                            period: { $first: '$period' },
                            inactive: { $first: '$inactive' },
                            event_type: { $first: '$event_type' },
                            event_time: { $first: '$event_time' }
                        }
                    }
                ]
            });
        }

        // Create indexes
        const eventCollection = db.collection(COLLECTIONS.GROUP_MEMBER_EVENTS);
        await eventCollection.createIndex(
            { group_id: 1, member_type: 1, member_object_id: 1, _id: -1 },
            { name: 'groupId_memberType_memberObjectId_id' }
        );
        await eventCollection.createIndex(
            { member_type: 1, member_object_id: 1, group_id: 1, _id: -1 },
            { name: 'memberType_memberObjectId_groupId_id' }
        );

        // Pre-create 1M Patient stubs for member reference validation
        console.log('Creating 1,000,000 Patient stubs for reference validation...');
        const stubStart = Date.now();
        await createPatientStubs(1_000_000);
        console.log(`Patient stubs created in ${((Date.now() - stubStart) / 1000).toFixed(1)}s\n`);
    }, 600000); // 10 min setup timeout for 1M patients

    afterAll(async () => {
        await commonAfterEach();
    }, 120000);

    function getTestHeaders() {
        return {
            ...getHeaders(),
            subGroupMemberRequest: 'true'
        };
    }

    const SOURCE_ASSIGNING_AUTHORITY = 'perf-test-owner';

    async function createPatientStubs(count) {
        const collection = db.collection('Patient_4_0_0');
        const BATCH = 10000;

        for (let offset = 0; offset < count; offset += BATCH) {
            const batchEnd = Math.min(offset + BATCH, count);
            const patients = [];
            for (let i = offset; i < batchEnd; i++) {
                const patientId = `${i + 1}`;
                patients.push({
                    id: patientId,
                    resourceType: 'Patient',
                    _uuid: generateUUIDv5(`${patientId}|${SOURCE_ASSIGNING_AUTHORITY}`),
                    _sourceId: patientId,
                    _sourceAssigningAuthority: SOURCE_ASSIGNING_AUTHORITY,
                    meta: {
                        security: [
                            { system: 'https://www.icanbwell.com/owner', code: 'perf-test-owner' },
                            { system: 'https://www.icanbwell.com/access', code: 'perf-test-access' }
                        ]
                    }
                });
            }
            await collection.insertMany(patients, { ordered: false });

            if ((offset + BATCH) % 100000 === 0) {
                console.log(`  ${((offset + BATCH) / 1000)}K patients created...`);
            }
        }
    }

    /**
     * Prints storage stats for all collections used by the test
     */
    async function printStorageStats(label) {
        console.log(`\n========================================`);
        console.log(`Storage Stats: ${label}`);
        console.log(`========================================`);

        const collections = [COLLECTIONS.GROUP_MEMBER_EVENTS, 'Group_4_0_0', 'Patient_4_0_0'];
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

    async function getViewMemberCount(groupId) {
        const groupDoc = await db.collection('Group_4_0_0').findOne(
            { id: groupId },
            { projection: { _id: 1 } }
        );
        if (!groupDoc) return 0;

        const view = db.collection(COLLECTIONS.GROUP_MEMBER_CURRENT);
        return await view.countDocuments({
            group_id: groupDoc._id,
            event_type: 'added',
            $or: [{ inactive: false }, { inactive: { $exists: false } }]
        });
    }

    test('Load 1M members via PATCH (100 calls x 10K operations)', async () => {
        const groupId = `perf-1m-mongo-${Date.now()}`;
        const OPERATIONS_PER_PATCH = 10000;
        const TARGET_MEMBERS = 1_000_000;
        const NUM_PATCHES = TARGET_MEMBERS / OPERATIONS_PER_PATCH; // 100

        console.log('\n========================================');
        console.log('1M Member Loading - MongoDB PATCH');
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

        // Step 2: Load members via PATCH
        console.log('Step 2: Loading members via PATCH...\n');

        const patchTimes = [];
        let currentCount = 0;

        for (let batch = 1; batch <= NUM_PATCHES; batch++) {
            const startIndex = currentCount + 1;

            const operations = Array.from({ length: OPERATIONS_PER_PATCH }, (_, i) => ({
                op: 'add',
                path: '/member/-',
                value: { entity: { reference: `Patient/${startIndex + i}` } }
            }));

            const startTime = Date.now();

            const patchResponse = await request
                .patch(`/4_0_0/Group/${actualGroupId}`)
                .send(operations)
                .set(getTestHeaders())
                .set('Content-Type', 'application/json-patch+json');

            const patchTime = Date.now() - startTime;
            patchTimes.push(patchTime);

            if (patchResponse.status !== 200) {
                console.error(`Batch ${batch} FAILED with status ${patchResponse.status}:`);
                console.error(JSON.stringify(patchResponse.body, null, 2).substring(0, 1000));
                expect(patchResponse.status).toBe(200);
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

        // Step 3: Verify final count with MongoDB view
        console.log('\n========================================');
        console.log('Verification: MongoDB View Query');
        console.log('========================================\n');

        await new Promise(r => setTimeout(r, 2000));

        const queryStart = Date.now();
        const finalCount = await getViewMemberCount(actualGroupId);
        const queryTime = Date.now() - queryStart;

        console.log(`View query time: ${queryTime}ms`);
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
        console.log('\nSuccessfully loaded 1M members using MongoDB PATCH');
        console.log('Pure append operations (no reads, no diffs)');
        console.log('Constant payload size per PATCH');
        console.log('MongoDB view verified deterministic final state');

        await printStorageStats('1M PATCH Loading');

    }, 600000); // 10 minute timeout
});
