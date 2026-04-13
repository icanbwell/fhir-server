/**
 * Shared test setup for MongoDB Direct Group Member tests (V2)
 *
 * Simpler than V1 setup — no view creation needed, just collection + indexes.
 *
 * Usage:
 *   const { setupDirectGroupTests, getSharedRequest, getTestHeaders } = require('./mongoDirectGroupMemberTestSetup');
 *
 *   beforeAll(async () => {
 *     await setupDirectGroupTests();
 *   });
 */

const { commonBeforeEach, commonAfterEach, createTestRequest, getHeaders } = require('../common');
const { COLLECTIONS } = require('../../constants/mongoGroupMemberConstants');

// Set env vars BEFORE any requires — Direct member storage, no ClickHouse
process.env.ENABLE_MONGO_DIRECT_GROUP_MEMBERS = '1';
process.env.LOGLEVEL = 'SILENT';
process.env.STREAM_RESPONSE = '0';

let sharedRequest = null;
let isSetupComplete = false;
let setupPromise = null;

/**
 * Creates the direct member collection and indexes in the in-memory MongoDB.
 * This is normally done by createCollectionsRunner.js at server startup.
 *
 * @param {import('mongodb').Db} db
 */
async function createDirectMemberCollection(db) {
    const existingCollections = await db.listCollections().toArray();
    const collectionNames = existingCollections.map(c => c.name);

    if (!collectionNames.includes(COLLECTIONS.GROUP_MEMBER_DIRECT)) {
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
}

/**
 * Sets up shared test infrastructure (call once in beforeAll)
 */
async function setupDirectGroupTests() {
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

            const { createTestContainer } = require('../createTestContainer');
            const container = createTestContainer();
            const db = await container.mongoDatabaseManager.getClientDbAsync();
            await createDirectMemberCollection(db);

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
async function teardownDirectGroupTests() {
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
 * Cleans up all Group + direct member data between tests
 */
async function cleanupAllData() {
    try {
        const { createTestContainer } = require('../createTestContainer');
        const container = createTestContainer();
        const db = await container.mongoDatabaseManager.getClientDbAsync();

        await db.collection('Group_4_0_0').deleteMany({});
        await db.collection(COLLECTIONS.GROUP_MEMBER_DIRECT).deleteMany({});
        await db.collection('Patient_4_0_0').deleteMany({});
    } catch (e) {
        // Ignore cleanup errors
    }
}

/**
 * Helper to get standard test headers including the directGroupMemberRequest header
 * that activates the MongoDB Direct member storage flow per-request
 */
function getTestHeaders() {
    return {
        ...getHeaders(),
        directGroupMemberRequest: 'true'
    };
}

function getSharedRequest() {
    if (!sharedRequest) {
        throw new Error('setupDirectGroupTests() must be called before getSharedRequest()');
    }
    return sharedRequest;
}

module.exports = {
    setupDirectGroupTests,
    teardownDirectGroupTests,
    cleanupAllData,
    getSharedRequest,
    getTestHeaders,
    createDirectMemberCollection
};
