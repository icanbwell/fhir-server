const { describe, test, beforeEach, afterEach, expect, jest } = require('@jest/globals');
const { Collection } = require('mongodb');
const { commonBeforeEach, commonAfterEach, getTestContainer, createTestRequest, getHeaders } = require('../../common');
const { SecurityTagSystem } = require('../../../../utils/securityTagSystem');

const COLLECTION = 'Patient_4_0_0';

function patientBody ({ gender = 'male' } = {}) {
    return {
        resourceType: 'Patient',
        id: 'put-cc-1',
        gender,
        name: [{ family: 'Synthetic', given: ['Put'] }],
        meta: {
            source: 'http://example.com/put-concurrency',
            security: [
                { system: SecurityTagSystem.owner, code: 'bwell' },
                { system: SecurityTagSystem.access, code: 'bwell' }
            ]
        }
    };
}

function isCreateOf (collection, ops) {
    return collection.collectionName === COLLECTION && Array.isArray(ops) &&
        ops.some((o) => o.updateOne && o.updateOne.upsert && o.updateOne.update.$setOnInsert);
}

function isUpdateOf (collection, ops) {
    return collection.collectionName === COLLECTION && Array.isArray(ops) && ops.some((o) => o.replaceOne);
}

/**
 * Before this request's create reaches Mongo, another writer creates the same resource; optionally
 * the other writer also keeps updating it before every retry
 * @param {Object} [options]
 * @param {(doc: Object) => Object} [options.concurrentCreate] - builds the other writer's document
 * @param {boolean} [options.keepUpdating]
 */
async function raceAgainstConcurrentWriter ({ concurrentCreate = (doc) => ({ ...doc, gender: 'female' }), keepUpdating = false } = {}) {
    const db = await getTestContainer().mongoDatabaseManager.getClientDbAsync();
    const realBulkWrite = Collection.prototype.bulkWrite;
    const state = { created: false, updates: 0 };
    jest.spyOn(Collection.prototype, 'bulkWrite').mockImplementation(async function (ops, options) {
        if (!state.created && isCreateOf(this, ops)) {
            state.created = true;
            const { _id, ...doc } = ops.find((o) => o.updateOne).updateOne.update.$setOnInsert;
            await db.collection(COLLECTION).insertOne(concurrentCreate(doc));
        } else if (keepUpdating && isUpdateOf(this, ops)) {
            state.updates += 1;
            const current = await db.collection(COLLECTION).findOne({});
            await db.collection(COLLECTION).updateOne(
                { _uuid: current._uuid },
                { $set: { 'meta.versionId': `${parseInt(current.meta.versionId) + 1}` } }
            );
        }
        return realBulkWrite.call(this, ops, options);
    });
    return state;
}

describe('PUT create racing a concurrent create', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        jest.restoreAllMocks();
        await commonAfterEach();
    });

    test('a PUT create that loses to a concurrent create returns 200 with the stored version', async () => {
        const request = await createTestRequest();
        const state = await raceAgainstConcurrentWriter();

        const resp = await request.put('/4_0_0/Patient/put-cc-1').send(patientBody()).set(getHeaders());

        expect(state.created).toBe(true);
        expect(resp.status).toBe(200);
        expect(resp.body.meta.versionId).toBe('2');
        const db = await getTestContainer().mongoDatabaseManager.getClientDbAsync();
        const stored = await db.collection(COLLECTION).findOne({});
        expect(stored.gender).toBe('male');
        expect(stored.meta.versionId).toBe('2');
    });

    test('a PUT create that keeps losing returns 409 with a conflict OperationOutcome', async () => {
        const request = await createTestRequest();
        const state = await raceAgainstConcurrentWriter({ keepUpdating: true });

        const resp = await request.put('/4_0_0/Patient/put-cc-1').send(patientBody()).set(getHeaders());

        expect(state.updates).toBe(3);
        expect(resp.status).toBe(409);
        expect(resp.body.resourceType).toBe('OperationOutcome');
        expect(resp.body.issue[0].code).toBe('conflict');
        expect(resp.body.issue[0].diagnostics).toContain('could not be saved after 3 attempts');
    });

    test('a PUT create rebased onto a document the caller may not write returns 403', async () => {
        const request = await createTestRequest();
        await raceAgainstConcurrentWriter({
            concurrentCreate: (doc) => ({
                ...doc,
                gender: 'female',
                _access: { 'other-client': 1 },
                meta: {
                    ...doc.meta,
                    security: [
                        { system: SecurityTagSystem.owner, code: 'bwell' },
                        { system: SecurityTagSystem.access, code: 'other-client' },
                        { system: SecurityTagSystem.sourceAssigningAuthority, code: 'bwell' }
                    ]
                }
            })
        });

        const resp = await request
            .put('/4_0_0/Patient/put-cc-1')
            .send(patientBody())
            .set(getHeaders('user/*.read user/*.write access/bwell.*'));

        expect(resp.status).toBe(403);
        const db = await getTestContainer().mongoDatabaseManager.getClientDbAsync();
        const stored = await db.collection(COLLECTION).findOne({});
        expect(stored.gender).toBe('female');
    });

    test('If-None-Match * on a lost create still returns 412', async () => {
        const request = await createTestRequest();
        await raceAgainstConcurrentWriter();

        const resp = await request
            .put('/4_0_0/Patient/put-cc-1')
            .send(patientBody())
            .set({ ...getHeaders(), 'If-None-Match': '*' });

        expect(resp.status).toBe(412);
    });
});
