const { describe, test, beforeEach, afterEach, expect, jest } = require('@jest/globals');
const {
    commonBeforeEach, commonAfterEach, getTestContainer, createTestRequest, getHeaders
} = require('../../common');
const { Collection } = require('mongodb');

const SYSTEMS = {
    access: 'https://www.icanbwell.com/access',
    owner: 'https://www.icanbwell.com/owner',
    saa: 'https://www.icanbwell.com/sourceAssigningAuthority'
};

async function rawDoc(container, collectionName) {
    const db = await container.mongoDatabaseManager.getClientDbAsync();
    return db.collection(collectionName).findOne({});
}

function tagCounts(security) {
    const counts = {};
    for (const s of security || []) {
        counts[s.system] = (counts[s.system] || 0) + 1;
    }
    return counts;
}

/**
 * Creates a resource, then issues an update while a spy simulates another pod bumping meta.versionId
 * right before our UPDATE bulk write commits -> forces the real optimistic-concurrency retry path.
 */
async function mergeWithForcedConcurrentRetry({ resourceType, collectionName, build }) {
    const request = await createTestRequest();
    const container = getTestContainer();

    const createResp = await request
        .post(`/4_0_0/${resourceType}/1/$merge`)
        .send(build('Old'))
        .set(getHeaders());
    expect(createResp.status).toBe(200);

    const db = await container.mongoDatabaseManager.getClientDbAsync();
    const realBulkWrite = Collection.prototype.bulkWrite;
    let bumped = false;
    jest.spyOn(Collection.prototype, 'bulkWrite').mockImplementation(async function (ops, options) {
        const isUpdateToTarget = this.collectionName === collectionName &&
            Array.isArray(ops) && ops.some(o => o.replaceOne);
        if (isUpdateToTarget && !bumped) {
            bumped = true;
            const current = await db.collection(collectionName).findOne({});
            await db.collection(collectionName).updateOne(
                { _uuid: current._uuid },
                { $set: { 'meta.versionId': `${parseInt(current.meta.versionId) + 1}` } }
            );
        }
        return realBulkWrite.call(this, ops, options);
    });

    try {
        const updateResp = await request
            .post(`/4_0_0/${resourceType}/1/$merge`)
            .send(build('New'))
            .set(getHeaders());
        expect(updateResp.status).toBe(200);
        expect(bumped).toBe(true); // ensure the retry path was actually exercised
    } finally {
        Collection.prototype.bulkWrite.mockRestore();
    }

    return tagCounts((await rawDoc(container, collectionName)).meta.security);
}

describe('Concurrent-retry duplicate meta.security', () => {
    let savedCodingIdResources;
    beforeEach(async () => {
        savedCodingIdResources = process.env.PRE_SAVE_CODING_ID_UPDATE_RESOURCES;
        // mirror prod default so coding-id stamping only applies to Binary,Observation
        process.env.PRE_SAVE_CODING_ID_UPDATE_RESOURCES = 'Binary,Observation';
        await commonBeforeEach();
    });
    afterEach(async () => {
        if (savedCodingIdResources === undefined) delete process.env.PRE_SAVE_CODING_ID_UPDATE_RESOURCES;
        else process.env.PRE_SAVE_CODING_ID_UPDATE_RESOURCES = savedCodingIdResources;
        await commonAfterEach();
    });

    test('Patient (not a coding-id type) does not duplicate owner on retry', async () => {
        const counts = await mergeWithForcedConcurrentRetry({
            resourceType: 'Patient',
            collectionName: 'Patient_4_0_0',
            build: (family) => ({
                resourceType: 'Patient', id: 'e1', name: [{ family }],
                meta: { source: 'http://example.com', security: [
                    { system: SYSTEMS.access, code: 'bwell' },
                    { system: SYSTEMS.owner, code: 'bwell' }
                ] }
            })
        });
        expect(counts[SYSTEMS.owner]).toBe(1);
        expect(counts[SYSTEMS.access]).toBe(1);
        expect(counts[SYSTEMS.saa]).toBe(1);
    });

    test('differing meta.security tag ORDER between create and update does not duplicate on retry', async () => {
        const counts = await mergeWithForcedConcurrentRetry({
            resourceType: 'Patient',
            collectionName: 'Patient_4_0_0',
            // create sends [access, owner]; the concurrent update sends them reversed [owner, access]
            build: (family) => {
                const security = family === 'New'
                    ? [{ system: SYSTEMS.owner, code: 'bwell' }, { system: SYSTEMS.access, code: 'bwell' }]
                    : [{ system: SYSTEMS.access, code: 'bwell' }, { system: SYSTEMS.owner, code: 'bwell' }];
                return {
                    resourceType: 'Patient', id: 'e1', name: [{ family }],
                    meta: { source: 'http://example.com', security }
                };
            }
        });
        expect(counts[SYSTEMS.owner]).toBe(1);
        expect(counts[SYSTEMS.access]).toBe(1);
        expect(counts[SYSTEMS.saa]).toBe(1);
    });

    test('Observation (a coding-id type) does not duplicate tags on retry', async () => {
        const counts = await mergeWithForcedConcurrentRetry({
            resourceType: 'Observation',
            collectionName: 'Observation_4_0_0',
            build: (text) => ({
                resourceType: 'Observation', id: 'e1', status: 'final', code: { text },
                meta: { source: 'http://example.com', security: [
                    { system: SYSTEMS.access, code: 'bwell' },
                    { system: SYSTEMS.owner, code: 'bwell' }
                ] }
            })
        });
        expect(counts[SYSTEMS.owner]).toBe(1);
        expect(counts[SYSTEMS.access]).toBe(1);
        expect(counts[SYSTEMS.saa]).toBe(1);
    });
});
