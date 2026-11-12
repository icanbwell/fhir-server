const { describe, test, beforeEach, afterEach, expect, jest } = require('@jest/globals');
const { Collection } = require('mongodb');
const { commonBeforeEach, commonAfterEach, getTestContainer, createTestRequest, getHeaders } = require('../../common');
const { SecurityTagSystem } = require('../../../../utils/securityTagSystem');

const COLLECTION = 'Patient_4_0_0';
const IDS = ['bcr-1', 'bcr-2', 'bcr-3'];
const RESTRICTED_SCOPES = 'user/*.read user/*.write access/bwell.*';

function patientBody (id, family) {
    return {
        resourceType: 'Patient',
        id,
        name: [{ family }],
        meta: {
            source: 'http://example.com/bulk-concurrency',
            security: [
                { system: SecurityTagSystem.owner, code: 'bwell' },
                { system: SecurityTagSystem.access, code: 'bwell' }
            ]
        }
    };
}

async function clientDbAsync () {
    return getTestContainer().mongoDatabaseManager.getClientDbAsync();
}

async function waitForPostRequestTasksAsync () {
    await getTestContainer().postRequestProcessor.waitTillAllRequestsDoneAsync({ timeoutInSeconds: 20 });
}

async function mergeAsync (request, ids, family, headers = getHeaders()) {
    const resp = await request
        .post('/4_0_0/Patient/1/$merge')
        .send(ids.map((id) => patientBody(id, family)))
        .set(headers);
    await waitForPostRequestTasksAsync();
    return resp;
}

/**
 * Polls, because the history write runs in a post-request task
 * @param {string} uuid
 * @param {number} expected
 * @returns {Promise<number>}
 */
async function historyCountAsync (uuid, expected) {
    const historyDb = await getTestContainer().mongoDatabaseManager.getResourceHistoryDbAsync();
    let count = 0;
    for (let attempt = 0; attempt < 50; attempt++) {
        count = await historyDb.collection(`${COLLECTION}_History`).countDocuments({ 'resource._uuid': uuid });
        if (count === expected) {
            break;
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
    }
    return count;
}

async function storedAsync (id) {
    const db = await clientDbAsync();
    return db.collection(COLLECTION).findOne({ id });
}

function entryFor (body, id) {
    return body.find((entry) => entry.id === id);
}

/**
 * Before a write of the target's update reaches Mongo, another writer updates the stored document
 * @param {string} targetId
 * @param {Object} [options]
 * @param {boolean} [options.always] - on every write of the target, not only the first
 * @param {Object} [options.alsoSet] - fields the other writer changes besides meta.versionId
 * @returns {Promise<{bumps: number}>}
 */
async function updateConcurrently (targetId, { always = false, alsoSet = {} } = {}) {
    const db = await clientDbAsync();
    const realBulkWrite = Collection.prototype.bulkWrite;
    const state = { bumps: 0 };
    jest.spyOn(Collection.prototype, 'bulkWrite').mockImplementation(async function (ops, options) {
        const writesTarget = this.collectionName === COLLECTION && Array.isArray(ops) &&
            ops.some((o) => o.replaceOne && o.replaceOne.replacement.id === targetId);
        if (writesTarget && (always || state.bumps === 0)) {
            state.bumps += 1;
            const current = await db.collection(COLLECTION).findOne({ id: targetId });
            await db.collection(COLLECTION).updateOne(
                { _uuid: current._uuid },
                { $set: { 'meta.versionId': `${parseInt(current.meta.versionId) + 1}`, ...alsoSet } }
            );
        }
        return realBulkWrite.call(this, ops, options);
    });
    return state;
}

/**
 * Before the target's create reaches Mongo, another writer creates the same resource
 * @param {string} targetId
 * @returns {Promise<{created: boolean}>}
 */
async function createConcurrently (targetId) {
    const db = await clientDbAsync();
    const realBulkWrite = Collection.prototype.bulkWrite;
    const state = { created: false };
    jest.spyOn(Collection.prototype, 'bulkWrite').mockImplementation(async function (ops, options) {
        const create = this.collectionName === COLLECTION && Array.isArray(ops)
            ? ops.find((o) => o.updateOne?.upsert && o.updateOne.update.$setOnInsert?.id === targetId)
            : null;
        if (create && !state.created) {
            state.created = true;
            const { _id, ...doc } = create.updateOne.update.$setOnInsert;
            await db.collection(COLLECTION).insertOne({ ...doc, name: [{ family: 'Other' }] });
        }
        return realBulkWrite.call(this, ops, options);
    });
    return state;
}

function patientEventsFor (afterSaveSpy, id) {
    return afterSaveSpy.mock.calls
        .map(([args]) => args)
        .filter((args) => args.resourceType === 'Patient' && args.doc.id === id)
        .map((args) => args.eventType);
}

describe('$merge resolving concurrent writes', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        jest.restoreAllMocks();
        await commonAfterEach();
    });

    test('one conflicting resource in a batch of 3 is resolved: all 3 report updated, each has a new history entry', async () => {
        const request = await createTestRequest();
        await mergeAsync(request, IDS, 'Old');
        const state = await updateConcurrently('bcr-2');

        const resp = await mergeAsync(request, IDS, 'New');

        expect(state.bumps).toBe(1);
        expect(resp.status).toBe(200);
        for (const id of IDS) {
            const entry = entryFor(resp.body, id);
            expect(entry.updated).toBe(true);
            expect(entry.issue).toBeUndefined();
            const stored = await storedAsync(id);
            expect(stored.name.map((n) => n.family)).toContain('New');
            expect(await historyCountAsync(stored._uuid, 2)).toBe(2);
        }
        expect((await storedAsync('bcr-2')).meta.versionId).toBe('3');
    });

    test('a resource that keeps conflicting past CONCURRENCY_RESOLUTION_ROUNDS gets a conflict issue and the others still save', async () => {
        const request = await createTestRequest();
        await mergeAsync(request, IDS, 'Old');
        const state = await updateConcurrently('bcr-2', { always: true });

        const resp = await mergeAsync(request, IDS, 'New');

        expect(state.bumps).toBe(4);
        expect(resp.status).toBe(200);
        const conflicted = entryFor(resp.body, 'bcr-2');
        expect(conflicted.updated).toBe(false);
        expect(conflicted.issue.code).toBe('conflict');
        expect(conflicted.issue.diagnostics).toContain('could not be saved after 3 attempts');
        expect((await storedAsync('bcr-2')).name.map((n) => n.family)).not.toContain('New');
        expect(await historyCountAsync((await storedAsync('bcr-2'))._uuid, 1)).toBe(1);
        for (const id of ['bcr-1', 'bcr-3']) {
            expect(entryFor(resp.body, id).updated).toBe(true);
            expect(await historyCountAsync((await storedAsync(id))._uuid, 2)).toBe(2);
        }
    });

    test('a lost create is saved as an update of the concurrently created document', async () => {
        const request = await createTestRequest();
        const state = await createConcurrently('bcr-1');

        const resp = await mergeAsync(request, ['bcr-1'], 'New');

        expect(state.created).toBe(true);
        expect(resp.status).toBe(200);
        const entry = Array.isArray(resp.body) ? resp.body[0] : resp.body;
        expect(entry.updated).toBe(true);
        expect(entry.created).toBeFalsy();
        expect(entry.issue).toBeUndefined();
        const stored = await storedAsync('bcr-1');
        expect(stored.name.map((n) => n.family).sort()).toEqual(['New', 'Other']);
        expect(stored.meta.versionId).toBe('2');
    });

    test('a winner in a conflicting batch fires its change event', async () => {
        const request = await createTestRequest();
        await mergeAsync(request, IDS, 'Old');
        const afterSaveSpy = jest.spyOn(getTestContainer().postSaveProcessor, 'afterSaveAsync');
        await updateConcurrently('bcr-2');

        await mergeAsync(request, IDS, 'New');

        for (const id of IDS) {
            expect(patientEventsFor(afterSaveSpy, id)).toEqual(['U']);
        }
    });

    test('a lost create fires U, not C', async () => {
        const request = await createTestRequest();
        const afterSaveSpy = jest.spyOn(getTestContainer().postSaveProcessor, 'afterSaveAsync');
        await createConcurrently('bcr-1');

        await mergeAsync(request, ['bcr-1'], 'New');

        expect(patientEventsFor(afterSaveSpy, 'bcr-1')).toEqual(['U']);
    });

    test('a rebased write onto a resource whose access tag changed outside the caller scopes gets a forbidden issue', async () => {
        const request = await createTestRequest();
        await mergeAsync(request, IDS, 'Old');
        await updateConcurrently('bcr-2', {
            alsoSet: {
                _access: { 'other-client': 1 },
                'meta.security': [
                    { system: SecurityTagSystem.owner, code: 'bwell' },
                    { system: SecurityTagSystem.access, code: 'other-client' },
                    { system: SecurityTagSystem.sourceAssigningAuthority, code: 'bwell' }
                ]
            }
        });

        const resp = await mergeAsync(request, IDS, 'New', getHeaders(RESTRICTED_SCOPES));

        expect(resp.status).toBe(200);
        const forbidden = entryFor(resp.body, 'bcr-2');
        expect(forbidden.updated).toBe(false);
        expect(forbidden.issue.code).toBe('forbidden');
        expect((await storedAsync('bcr-2')).name.map((n) => n.family)).not.toContain('New');
        for (const id of ['bcr-1', 'bcr-3']) {
            expect(entryFor(resp.body, id).updated).toBe(true);
        }
    });

    test('an If-Match PUT whose version was bumped concurrently returns 412', async () => {
        const request = await createTestRequest();
        await mergeAsync(request, ['bcr-1'], 'Old');
        const state = await updateConcurrently('bcr-1');

        const resp = await request
            .put('/4_0_0/Patient/bcr-1')
            .send(patientBody('bcr-1', 'New'))
            .set({ ...getHeaders(), 'If-Match': 'W/"1"' });

        expect(state.bumps).toBe(1);
        expect(resp.status).toBe(412);
        expect((await storedAsync('bcr-1')).name.map((n) => n.family)).not.toContain('New');
    });
});
