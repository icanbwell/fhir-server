/**
 * Shared test setup for MongoDB Group Member tests
 *
 * Parallel to groupTestSetup.js but uses MongoDB-only member storage
 * (no ClickHouse dependency). Sets ENABLE_MONGO_GROUP_MEMBERS instead.
 *
 * Usage:
 *   const { setupMongoGroupTests, getSharedRequest, getTestHeaders } = require('./mongoGroupMemberTestSetup');
 *
 *   beforeAll(async () => {
 *     await setupMongoGroupTests();
 *   });
 */

const { commonBeforeEach, commonAfterEach, createTestRequest, getHeaders } = require('../common');
const { COLLECTIONS } = require('../../constants/mongoGroupMemberConstants');

// Set env vars BEFORE any requires — MongoDB member storage, no ClickHouse
process.env.ENABLE_MONGO_GROUP_MEMBERS = '1';
process.env.LOGLEVEL = 'SILENT';
process.env.STREAM_RESPONSE = '0';

// Shared singleton instances
let sharedRequest = null;
let isSetupComplete = false;
let setupPromise = null;

/**
 * Creates the MongoDB view for Group member current state.
 * This is normally done by createCollectionsRunner.js at server startup.
 * In tests we must create it programmatically against the in-memory MongoDB.
 *
 * @param {import('mongodb').Db} db - MongoDB database handle
 */
async function createMemberView(db) {
    const existingCollections = await db.listCollections().toArray();
    const collectionNames = existingCollections.map(c => c.name);

    // Create event collection if needed
    if (!collectionNames.includes(COLLECTIONS.GROUP_MEMBER_EVENTS)) {
        await db.createCollection(COLLECTIONS.GROUP_MEMBER_EVENTS);
    }

    // Create current-state view if needed (use db.command — db.createView not available in all drivers)
    if (!collectionNames.includes(COLLECTIONS.GROUP_MEMBER_CURRENT)) {
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
}

/**
 * Sets up shared test infrastructure (call once in beforeAll)
 */
async function setupMongoGroupTests() {
    if (setupPromise) {
        return setupPromise;
    }
    if (isSetupComplete) {
        return;
    }

    setupPromise = (async () => {
        try {
            await commonBeforeEach();
            sharedRequest = await createTestRequest();

            // Create the MongoDB view for member current state
            const { createTestContainer } = require('../createTestContainer');
            const container = createTestContainer();
            const db = await container.mongoDatabaseManager.getClientDbAsync();
            await createMemberView(db);

            isSetupComplete = true;
        } catch (error) {
            setupPromise = null;
            throw error;
        }
    })();

    return setupPromise;
}

/**
 * Tears down shared test infrastructure (call once in afterAll)
 */
async function teardownMongoGroupTests() {
    if (!isSetupComplete) {
        return;
    }

    try {
        await commonAfterEach();
        sharedRequest = null;
        isSetupComplete = false;
        setupPromise = null;
    } catch (error) {
        console.error('Error during teardown:', error);
        throw error;
    }
}

/**
 * Cleans up all Group + member event data between tests
 */
async function cleanupAllData() {
    try {
        const { createTestContainer } = require('../createTestContainer');
        const container = createTestContainer();
        const db = await container.mongoDatabaseManager.getClientDbAsync();

        await db.collection('Group_4_0_0').deleteMany({});
        await db.collection(COLLECTIONS.GROUP_MEMBER_EVENTS).deleteMany({});
        // Also clean up Patient resources used in tests
        await db.collection('Patient_4_0_0').deleteMany({});
    } catch (e) {
        // Ignore cleanup errors
    }
}

/**
 * Helper to get standard test headers including the subGroupMemberRequest header
 * that activates the MongoDB member storage flow per-request
 */
function getTestHeaders() {
    return {
        ...getHeaders(),
        subGroupMemberRequest: 'true'
    };
}

function getSharedRequest() {
    if (!sharedRequest) {
        throw new Error('setupMongoGroupTests() must be called before getSharedRequest()');
    }
    return sharedRequest;
}

module.exports = {
    setupMongoGroupTests,
    teardownMongoGroupTests,
    cleanupAllData,
    getSharedRequest,
    getTestHeaders,
    createMemberView
};
