/**
 * MongoDB Group Member - Incremental Loading Performance Test
 *
 * Mirrors incremental_loading.test.js but uses MongoDB member storage
 * instead of ClickHouse. Requires Docker MongoDB (`docker-compose up -d mongo`).
 *
 * Patterns tested:
 * 1. PUT pattern: POST initial + PUT full array (10K scale)
 * 2. PATCH pattern: POST initial + PATCH deltas (50K scale)
 *
 * Verification queries hit the MongoDB view (Group_4_0_0_MemberCurrent)
 * instead of ClickHouse argMax.
 *
 * Run:
 *   docker-compose up -d mongo
 *   nvm use && node node_modules/.bin/jest src/tests/performance/group/mongo_member_incremental_loading.test.js
 */

process.env.ENABLE_MONGO_GROUP_MEMBERS = '1';
process.env.MONGO_DB_NAME = 'fhir_perf_test'; // Isolate from dev data in shared Docker MongoDB
process.env.LOGLEVEL = 'SILENT';
process.env.STREAM_RESPONSE = '0';

const { describe, test, beforeAll, afterAll, expect } = require('@jest/globals');
const { commonBeforeEach, commonAfterEach, createTestRequest, getHeaders } = require('../../common');
const { ensureMongoDB } = require('../../ensureMongoDB');
const { COLLECTIONS } = require('../../../constants/mongoGroupMemberConstants');
const { generateUUIDv5 } = require('../../../utils/uid.util');

describe('MongoDB Member - Incremental Loading', () => {
    let db;
    let request;

    beforeAll(async () => {
        await ensureMongoDB();
        await commonBeforeEach();

        request = await createTestRequest();

        // Get db handle for direct verification queries
        const { createTestContainer } = require('../../createTestContainer');
        const container = createTestContainer();
        db = await container.mongoDatabaseManager.getClientDbAsync();

        // Create event collection + view (normally done by createCollectionsRunner)
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

        // Create indexes for performance
        const eventCollection = db.collection(COLLECTIONS.GROUP_MEMBER_EVENTS);
        await eventCollection.createIndex(
            { group_id: 1, member_type: 1, member_object_id: 1, _id: -1 },
            { name: 'groupId_memberType_memberObjectId_id' }
        );
        await eventCollection.createIndex(
            { member_type: 1, member_object_id: 1, group_id: 1, _id: -1 },
            { name: 'memberType_memberObjectId_groupId_id' }
        );

        // Pre-create Patient stubs so member reference validation passes
        // PUT test: Patient/1 .. Patient/10000
        // PATCH test: Patient/patch-1 .. Patient/patch-50000
        console.log('Creating Patient stubs for reference validation...');
        const stubStart = Date.now();
        await createPatientStubs(10000, '');
        await createPatientStubs(50000, 'patch-');
        console.log(`Patient stubs created in ${Date.now() - stubStart}ms\n`);
    }, 120000);

    afterAll(async () => {
        // if (db) {
        //     try {
        //         await db.dropDatabase();
        //         console.log('Dropped perf test database: fhir_perf_test');
        //     } catch (e) {
        //         console.warn('Cleanup warning:', e.message);
        //     }
        // }
        await commonAfterEach();
    }, 30000);

    function getTestHeaders() {
        return {
            ...getHeaders(),
            subGroupMemberRequest: 'true'
        };
    }

    const SOURCE_ASSIGNING_AUTHORITY = 'perf-test-owner';

    /**
     * Pre-creates minimal Patient documents in MongoDB so member reference validation passes.
     * Uses direct insertMany for speed — excluded from performance metrics (runs in beforeAll).
     *
     * @param {number} count - Number of patients to create
     * @param {string} idPrefix - Prefix for patient IDs (e.g., '' for '1','2',... or 'patch-' for 'patch-1',...)
     */
    async function createPatientStubs(count, idPrefix = '') {
        const collection = db.collection('Patient_4_0_0');
        const BATCH = 5000;

        for (let offset = 0; offset < count; offset += BATCH) {
            const batchEnd = Math.min(offset + BATCH, count);
            const patients = [];
            for (let i = offset; i < batchEnd; i++) {
                const patientId = `${idPrefix}${i + 1}`;
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
        }
        console.log(`Created ${count} Patient stubs (prefix: '${idPrefix || 'none'}')`);
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

        // Database-level stats
        const dbStats = await db.command({ dbStats: 1 });
        console.log(`  Database total:`);
        console.log(`    Data size: ${(dbStats.dataSize / 1024 / 1024).toFixed(2)}MB`);
        console.log(`    Storage size: ${(dbStats.storageSize / 1024 / 1024).toFixed(2)}MB`);
        console.log(`    Index size: ${(dbStats.indexSize / 1024 / 1024).toFixed(2)}MB`);
        console.log(`========================================\n`);
    }

    /**
     * Helper: query MongoDB view to get active member count for a Group
     */
    async function getViewMemberCount(groupId) {
        // Resolve Group ObjectId from id
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

    // ========== PUT-based incremental loading ==========

    test.each([
        [10000, 1000, 10, '10K']
    ])('Load %s members incrementally (%s per batch, PUT pattern)', async (TARGET_MEMBERS, BATCH_SIZE, NUM_BATCHES, label) => {
        const groupId = `perf-mongo-${label}-${Date.now()}`;

        console.log('\n========================================');
        console.log(`MongoDB Member Incremental Loading - ${label} Scale`);
        console.log('========================================');
        console.log(`Target: ${TARGET_MEMBERS.toLocaleString()} members`);
        console.log(`Batch size: ${BATCH_SIZE.toLocaleString()}`);
        console.log(`Total operations: 1 POST + ${NUM_BATCHES - 1} PUTs = ${NUM_BATCHES}`);
        console.log('Pattern: Each PUT sends FULL member array\n');

        const batchTimes = [];
        const milestones = [2000, 5000, 10000];

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
                name: `MongoDB Perf Test Group ${groupId}`,
                member: allMembers,
                meta: {
                    source: 'http://perf-test-system.com/Group',
                    security: [
                        { system: 'https://www.icanbwell.com/owner', code: 'perf-test-owner' },
                        { system: 'https://www.icanbwell.com/access', code: 'perf-test-access' }
                    ]
                }
            })
            .set(getTestHeaders());

        let batchTime = Date.now() - startTime;
        batchTimes.push(batchTime);

        expect(createResponse.status).toBe(201);

        const actualGroupId = createResponse.body.id;
        console.log(`  Created: ${actualGroupId} in ${batchTime}ms (${(batchTime / BATCH_SIZE).toFixed(2)}ms/member)\n`);

        // Verify initial event count
        await new Promise(r => setTimeout(r, 500));
        const initialCount = await getViewMemberCount(actualGroupId);
        console.log(`  MongoDB view: ${initialCount.toLocaleString()} active members\n`);
        expect(initialCount).toBe(BATCH_SIZE);

        // Remaining batches: PUT with incrementally larger member arrays
        let currentCount = BATCH_SIZE;

        for (let batch = 2; batch <= NUM_BATCHES; batch++) {
            const totalMembers = batch * BATCH_SIZE;

            console.log(`Batch ${batch}/${NUM_BATCHES}: PUT with ${totalMembers.toLocaleString()} members (adding ${BATCH_SIZE.toLocaleString()} more)...`);

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
                    name: `MongoDB Perf Test Group ${actualGroupId}`,
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
                .set(getTestHeaders());

            batchTime = Date.now() - startTime;
            batchTimes.push(batchTime);

            expect([200, 201]).toContain(updateResponse.status);
            console.log(`  Updated in ${batchTime}ms (${(batchTime / BATCH_SIZE).toFixed(2)}ms/member added)`);
            console.log(`     Request payload: ${(JSON.stringify(allMembers).length / 1024 / 1024).toFixed(2)}MB`);

            currentCount = totalMembers;

            // Verify count at milestones
            if (milestones.includes(currentCount)) {
                await new Promise(r => setTimeout(r, 500));
                const queryStart = Date.now();
                const verifiedCount = await getViewMemberCount(actualGroupId);
                const queryTime = Date.now() - queryStart;

                console.log(`  Milestone ${(currentCount / 1000)}K: view query ${queryTime}ms, verified ${verifiedCount.toLocaleString()} members`);
                expect(verifiedCount).toBe(currentCount);
            } else {
                await new Promise(r => setTimeout(r, 200));
            }
        }

        // Final verification
        console.log('\n========================================');
        console.log('Verification: MongoDB view query for final count');
        console.log('========================================\n');

        const queryStart = Date.now();
        const finalCount = await getViewMemberCount(actualGroupId);
        const queryTime = Date.now() - queryStart;

        console.log(`View query time: ${queryTime}ms`);
        console.log(`Final member count: ${finalCount.toLocaleString()}\n`);
        expect(finalCount).toBe(TARGET_MEMBERS);

        // Also verify via FHIR API (enrichment sets quantity)
        const getResponse = await request
            .get(`/4_0_0/Group/${actualGroupId}`)
            .set(getTestHeaders());

        expect(getResponse.status).toBe(200);
        console.log(`FHIR API quantity: ${getResponse.body.quantity}`);
        expect(getResponse.body.quantity).toBe(TARGET_MEMBERS);
        expect(getResponse.body.member).toBeUndefined();

        // Performance summary
        const totalTime = batchTimes.reduce((a, b) => a + b, 0);
        const avgBatchTime = Math.round(totalTime / batchTimes.length);
        const avgPerMember = (totalTime / TARGET_MEMBERS).toFixed(2);

        console.log('\n========================================');
        console.log('Performance Summary');
        console.log('========================================');
        console.log(`Total time: ${(totalTime / 1000).toFixed(2)}s`);
        console.log(`Average batch time: ${avgBatchTime}ms`);
        console.log(`Average per member: ${avgPerMember}ms`);
        console.log(`Throughput: ${Math.round(TARGET_MEMBERS / (totalTime / 1000))} members/second`);
        console.log(`\nSuccessfully loaded ${TARGET_MEMBERS.toLocaleString()} members using MongoDB member storage`);
        console.log('Each PUT sent complete member array (diff computed server-side)');
        console.log('MongoDB view verified final state');

        await printStorageStats(`PUT pattern - ${label}`);

    }, 600000);

    // ========== PATCH-based incremental loading ==========

    test('Load 50K members incrementally using PATCH (recommended pattern)', async () => {
        const TARGET_MEMBERS = 50000;
        const BATCH_SIZE = 5000;
        const NUM_BATCHES = 10;
        const groupId = `perf-mongo-patch-50k-${Date.now()}`;

        console.log('\n========================================');
        console.log('MongoDB Member PATCH-Based Loading - 50K Scale');
        console.log('========================================');
        console.log(`Target: ${TARGET_MEMBERS.toLocaleString()} members`);
        console.log(`Batch size: ${BATCH_SIZE.toLocaleString()} per PATCH`);
        console.log(`Total operations: 1 POST + ${NUM_BATCHES - 1} PATCHes = ${NUM_BATCHES}`);
        console.log('Pattern: Each PATCH sends only NEW members (efficient)\n');

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
                name: `MongoDB PATCH Perf Test Group ${groupId}`,
                member: initialMembers,
                meta: {
                    source: 'http://perf-test-system.com/Group',
                    security: [
                        { system: 'https://www.icanbwell.com/owner', code: 'perf-test-owner' },
                        { system: 'https://www.icanbwell.com/access', code: 'perf-test-access' }
                    ]
                }
            })
            .set(getTestHeaders());

        let batchTime = Date.now() - startTime;
        batchTimes.push(batchTime);
        expect(createResponse.status).toBe(201);

        const actualGroupId = createResponse.body.id;
        console.log(`  Created: ${actualGroupId} in ${batchTime}ms (${(batchTime / BATCH_SIZE).toFixed(2)}ms/member)\n`);

        await new Promise(r => setTimeout(r, 500));

        // Remaining batches: PATCH with only NEW members
        let currentCount = BATCH_SIZE;

        for (let batch = 2; batch <= NUM_BATCHES; batch++) {
            const newBatchStart = currentCount + 1;
            const newBatchEnd = batch * BATCH_SIZE;

            console.log(`Batch ${batch}/${NUM_BATCHES}: PATCH adding ${BATCH_SIZE.toLocaleString()} members (${newBatchStart} to ${newBatchEnd})...`);

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
                .set(getTestHeaders())
                .set('Content-Type', 'application/json-patch+json');

            batchTime = Date.now() - startTime;
            batchTimes.push(batchTime);

            expect(patchResponse.status).toBe(200);
            console.log(`  Patched in ${batchTime}ms (${(batchTime / BATCH_SIZE).toFixed(2)}ms/member added)`);
            console.log(`     Request payload: ${(JSON.stringify(patchOps).length / 1024).toFixed(2)}KB`);

            currentCount = newBatchEnd;
            await new Promise(r => setTimeout(r, 200));
        }

        // Final verification via MongoDB view
        console.log('\n========================================');
        console.log('Verification: MongoDB view query for final count');
        console.log('========================================\n');

        await new Promise(r => setTimeout(r, 500));

        const queryStart = Date.now();
        const finalCount = await getViewMemberCount(actualGroupId);
        const queryTime = Date.now() - queryStart;

        console.log(`View query time: ${queryTime}ms`);
        console.log(`Final member count: ${finalCount.toLocaleString()}\n`);
        expect(finalCount).toBe(TARGET_MEMBERS);

        // Also verify via FHIR API
        const getResponse = await request
            .get(`/4_0_0/Group/${actualGroupId}`)
            .set(getTestHeaders());

        expect(getResponse.status).toBe(200);
        console.log(`FHIR API quantity: ${getResponse.body.quantity}`);
        expect(getResponse.body.quantity).toBe(TARGET_MEMBERS);

        // Performance summary
        const totalTime = batchTimes.reduce((a, b) => a + b, 0);
        const avgBatchTime = Math.round(totalTime / batchTimes.length);
        const avgPerMember = (totalTime / TARGET_MEMBERS).toFixed(2);

        console.log('\n========================================');
        console.log('Performance Summary');
        console.log('========================================');
        console.log(`Total time: ${(totalTime / 1000).toFixed(2)}s`);
        console.log(`Average batch time: ${avgBatchTime}ms`);
        console.log(`Average per member: ${avgPerMember}ms`);
        console.log(`Throughput: ${Math.round(TARGET_MEMBERS / (totalTime / 1000))} members/second`);
        console.log(`\nSuccessfully loaded ${TARGET_MEMBERS.toLocaleString()} members using PATCH (MongoDB storage)`);
        console.log('Each PATCH sent only NEW members (efficient)');
        console.log('MongoDB view verified final state');

        await printStorageStats('PATCH pattern - 50K');

    }, 600000);
});
