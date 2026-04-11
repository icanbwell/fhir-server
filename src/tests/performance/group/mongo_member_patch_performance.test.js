/**
 * MongoDB Group Member - PATCH Performance Testing
 *
 * Mirrors patch_performance.test.js but uses MongoDB member storage
 * instead of ClickHouse. Requires Docker MongoDB (`docker-compose up -d mongo`).
 *
 * Tests:
 * 1. Operation limits: Find practical limits (100 -> 50K PATCH operations)
 * 2. Search performance at various Group sizes
 *
 * Verification queries hit the MongoDB view (Group_4_0_0_MemberCurrent)
 * instead of ClickHouse argMax.
 *
 * Run:
 *   docker-compose up -d mongo
 *   nvm use && node node_modules/.bin/jest src/tests/performance/group/mongo_member_patch_performance.test.js
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

describe('MongoDB Member - PATCH Performance Testing', () => {
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

        // Pre-create Patient stubs so member reference validation passes
        // Limit test: Patient/1 .. Patient/50000
        // Search test: Patient/search-perf-1 .. Patient/search-perf-5000
        console.log('Creating Patient stubs for reference validation...');
        const stubStart = Date.now();
        await createPatientStubs(50000, '');
        await createPatientStubs(5000, 'search-perf-');
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

    // ========== PATCH Operation Limits ==========

    describe('PATCH Operation Limits', () => {
        test('Find practical limit: 100, 1K, 5K, 10K, 25K, 50K operations', async () => {
            const testSizes = [100, 1000, 5000, 10000, 25000, 50000];
            const results = [];

            console.log('\n========================================');
            console.log('MongoDB Member - PATCH Operations Limit');
            console.log('========================================\n');

            for (const numOps of testSizes) {
                const groupId = `patch-limit-mongo-${numOps}-${Date.now()}`;

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

                // Build PATCH operations
                const operations = Array.from({ length: numOps }, (_, i) => ({
                    op: 'add',
                    path: '/member/-',
                    value: { entity: { reference: `Patient/${i + 1}` } }
                }));

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

                // Verify via MongoDB view
                await new Promise(r => setTimeout(r, 500));
                const verifiedCount = await getViewMemberCount(actualGroupId);
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
                console.log(`  MongoDB view verified: ${verified} (${verifiedCount} members)`);
                console.log(`  Passes threshold (<10s): ${passesThreshold}\n`);
            }

            await printStorageStats('PATCH Operation Limits');

            // Determine recommended limit
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

            // All tests should complete (not crash)
            expect(results.length).toBe(testSizes.length);

        }, 600000);
    });

    // ========== Search Performance at Scale ==========

    describe('Search Performance', () => {
        test('Search by member at various Group sizes', async () => {
            const groupSizes = [100, 1000, 5000];
            const results = [];

            console.log('\n========================================');
            console.log('MongoDB Member - Search Performance');
            console.log('========================================\n');

            for (const size of groupSizes) {
                const groupId = `search-perf-mongo-${size}-${Date.now()}`;

                // Create Group via POST
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

                // Add members via PATCH
                const patchOps = Array.from({ length: size }, (_, i) => ({
                    op: 'add',
                    path: '/member/-',
                    value: { entity: { reference: `Patient/search-perf-${i + 1}` } }
                }));

                await request
                    .patch(`/4_0_0/Group/${actualGroupId}`)
                    .set(getTestHeaders())
                    .set('Content-Type', 'application/json-patch+json')
                    .send(patchOps);

                await new Promise(r => setTimeout(r, 500));

                // Search for a member that exists
                const searchStart = Date.now();
                const searchResponse = await request
                    .get('/4_0_0/Group?member=Patient/search-perf-1')
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

            // All searches should find the group
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
});
