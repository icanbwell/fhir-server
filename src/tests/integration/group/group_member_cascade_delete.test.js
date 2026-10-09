/**
 * Cascade hard-delete of GroupMember rows on extended Group deletion (DCON-5655)
 *
 * DELETE /4_0_0/Group/{id} on an extended Group tombstones and hard-deletes every
 * GroupMember_4_0_0 row first, in bounded batches, and only then deletes the Group document.
 *
 * ENABLE_EXTENDED_GROUP is set to '1' globally in jest/setEnvVars.js.
 */
const { describe, test, beforeEach, afterEach, expect, jest } = require('@jest/globals');
const {
    commonBeforeEach,
    commonAfterEach,
    createTestRequest,
    getTestContainer,
    getHeaders,
    getHeadersJsonPatch,
    mockHttpContext
} = require('../common');
const { GROUP_MEMBER_COLLECTION_NAME, GROUP_MEMBER_HISTORY_COLLECTION_NAME } = require('../../../constants');
const { MONGO_GROUP_EXTENDED_FIELD } = require('../../../utils/mongoGroupExtendedTag');

const GROUP_COLLECTION_NAME = 'Group_4_0_0';

describe('Group cascade delete (extended storage)', () => {
    let request;
    let requestId;

    beforeEach(async () => {
        await commonBeforeEach();
        requestId = mockHttpContext();
        request = await createTestRequest();
    });

    afterEach(async () => {
        jest.restoreAllMocks();
        // Drop the per-test own-property overrides so the prototype getters (env-backed) apply again.
        const { configManager } = getTestContainer();
        for (const name of ['groupMemberCascadeDeleteBatchSize', 'enableExtendedGroup']) {
            delete configManager[name];
        }
        await commonAfterEach();
    });

    function defaultMeta() {
        return {
            source: 'http://test-system.com/Group',
            security: [
                { system: 'https://www.icanbwell.com/owner', code: 'test-owner' },
                { system: 'https://www.icanbwell.com/access', code: 'test-access' }
            ]
        };
    }

    async function getCollection(name) {
        const db = await getTestContainer().mongoDatabaseManager.getClientDbAsync();
        return db.collection(name);
    }

    async function markGroupExtended(groupId) {
        const groupCollection = await getCollection(GROUP_COLLECTION_NAME);
        await groupCollection.updateOne({ id: groupId }, { $set: { [MONGO_GROUP_EXTENDED_FIELD]: true } });
    }

    async function createGroup({ extended, id } = {}) {
        const body = { resourceType: 'Group', type: 'person', actual: true, meta: defaultMeta() };
        const response = id
            ? await request.put(`/4_0_0/Group/${id}`).send({ ...body, id }).set(getHeaders())
            : await request.post('/4_0_0/Group').send(body).set(getHeaders());
        expect([200, 201]).toContain(response.status);
        if (extended) {
            await markGroupExtended(response.body.id);
        }
        return response.body;
    }

    async function addMembers(groupId, count, prefix = 'cascade') {
        let lastResponse;
        for (let i = 0; i < count; i++) {
            lastResponse = await request
                .patch(`/4_0_0/Group/${groupId}`)
                .send([{ op: 'add', path: '/member/-', value: { entity: { reference: `Patient/${prefix}-${i}` } } }])
                .set(getHeadersJsonPatch());
            expect(lastResponse.status).toBe(200);
        }
        await getTestContainer().postRequestProcessor.waitTillDoneAsync({ requestId });
        return lastResponse.body;
    }

    async function deleteGroup(groupId) {
        const response = await request.delete(`/4_0_0/Group/${groupId}`).set(getHeaders());
        await getTestContainer().postRequestProcessor.waitTillDoneAsync({ requestId });
        return response;
    }

    async function groupUuidOf(groupId) {
        const groupCollection = await getCollection(GROUP_COLLECTION_NAME);
        const doc = await groupCollection.findOne({ id: groupId });
        return doc._uuid;
    }

    async function liveMemberCount(groupUuid) {
        const memberCollection = await getCollection(GROUP_MEMBER_COLLECTION_NAME);
        return await memberCollection.countDocuments({ groupUuid });
    }

    async function memberTombstones(groupUuid) {
        const historyCollection = await getCollection(GROUP_MEMBER_HISTORY_COLLECTION_NAME);
        return await historyCollection
            .find({ 'resource.groupUuid': groupUuid, 'request.method': 'DELETE' })
            .toArray();
    }

    function setCascadeBatchSize(batchSize) {
        Object.defineProperty(getTestContainer().configManager, 'groupMemberCascadeDeleteBatchSize', {
            get: () => batchSize, configurable: true
        });
    }

    function setExtendedGroupEnabled(value) {
        Object.defineProperty(getTestContainer().configManager, 'enableExtendedGroup', {
            get: () => value, configurable: true
        });
    }

    test('deletes every member row, writes one DELETE tombstone per row carrying its last-known member, then removes the Group', async () => {
        // 5 rows with batch size 2 => three batches (2, 2, 1).
        setCascadeBatchSize(2);
        const created = await createGroup({ extended: true });
        const lastPatched = await addMembers(created.id, 5);
        const groupUuid = await groupUuidOf(created.id);
        expect(await liveMemberCount(groupUuid)).toBe(5);

        const deleteResponse = await deleteGroup(created.id);

        expect([200, 204]).toContain(deleteResponse.status);
        expect(await liveMemberCount(groupUuid)).toBe(0);

        const groupCollection = await getCollection(GROUP_COLLECTION_NAME);
        expect(await groupCollection.findOne({ id: created.id })).toBeNull();

        const tombstones = await memberTombstones(groupUuid);
        expect(tombstones).toHaveLength(5);
        expect(new Set(tombstones.map((t) => t.resource._uuid)).size).toBe(5);
        for (const tombstone of tombstones) {
            expect(tombstone.resource.groupUuid).toBe(groupUuid);
            expect(tombstone.resource.member.entity.reference).toMatch(/^Patient\/cascade-/);
            // Stamped with the time of the delete, so strictly later than the last membership write:
            // that is what makes the tombstone win when history is reconstructed afterwards.
            expect(new Date(tombstone.resource.meta.lastUpdated).getTime())
                .toBeGreaterThan(new Date(lastPatched.meta.lastUpdated).getTime());
        }
        // Each member's own versionId is kept (no longer forced to the Group's).
        const versionIds = new Set(tombstones.map((t) => t.resource.meta.versionId));
        expect(versionIds.size).toBeGreaterThan(1);
    });

    test('a vread of an earlier version still reconstructs the roster after the Group is deleted', async () => {
        const created = await createGroup({ extended: true });
        const lastPatched = await addMembers(created.id, 3);

        await deleteGroup(created.id);

        const resp = await request
            .get(`/4_0_0/Group/${created.id}/_history/${lastPatched.meta.versionId}`)
            .set(getHeaders());
        expect(resp.status).toBe(200);
        const refs = (JSON.parse(resp.text).member || []).map((m) => m.entity.reference).sort();
        expect(refs).toEqual(['Patient/cascade-0', 'Patient/cascade-1', 'Patient/cascade-2']);
    });

    test('recreating the Group under the same id does not resurrect the old roster', async () => {
        const created = await createGroup({ extended: true });
        await addMembers(created.id, 3);
        await deleteGroup(created.id);

        const recreated = await createGroup({ extended: true, id: created.id });

        const live = await request.get(`/4_0_0/Group/${recreated.id}`).set(getHeaders());
        expect(live.status).toBe(200);
        expect(JSON.parse(live.text).member || []).toEqual([]);

        const vread = await request
            .get(`/4_0_0/Group/${recreated.id}/_history/${recreated.meta.versionId}`)
            .set(getHeaders());
        expect(vread.status).toBe(200);
        expect(JSON.parse(vread.text).member || []).toEqual([]);
    });

    test('a cascade that fails part-way leaves the Group live, and a retry finishes without re-tombstoning deleted rows', async () => {
        setCascadeBatchSize(1);
        const created = await createGroup({ extended: true });
        await addMembers(created.id, 3);
        const groupUuid = await groupUuidOf(created.id);

        const { removeHelper } = getTestContainer();
        const originalDeleteMany = removeHelper.deleteManyAsync.bind(removeHelper);
        let memberBatchCalls = 0;
        const spy = jest.spyOn(removeHelper, 'deleteManyAsync').mockImplementation(async (args) => {
            if (args.resourceType === 'GroupMember') {
                memberBatchCalls++;
                if (memberBatchCalls === 2) {
                    throw new Error('simulated failure on second batch');
                }
            }
            return await originalDeleteMany(args);
        });

        const failed = await deleteGroup(created.id);

        expect(failed.status).toBeGreaterThanOrEqual(400);
        const groupCollection = await getCollection(GROUP_COLLECTION_NAME);
        expect(await groupCollection.findOne({ id: created.id })).not.toBeNull();
        expect(await liveMemberCount(groupUuid)).toBe(2);
        expect(await memberTombstones(groupUuid)).toHaveLength(1);

        spy.mockRestore();
        const retried = await deleteGroup(created.id);

        expect([200, 204]).toContain(retried.status);
        expect(await groupCollection.findOne({ id: created.id })).toBeNull();
        expect(await liveMemberCount(groupUuid)).toBe(0);
        expect(await memberTombstones(groupUuid)).toHaveLength(3);
    });

    test('an extended Group with no members is deleted normally', async () => {
        const created = await createGroup({ extended: true });

        const response = await deleteGroup(created.id);

        expect([200, 204]).toContain(response.status);
        const groupCollection = await getCollection(GROUP_COLLECTION_NAME);
        expect(await groupCollection.findOne({ id: created.id })).toBeNull();
    });

    test('a conditional delete matching more than one extended Group is rejected and deletes nothing', async () => {
        const first = await createGroup({ extended: true });
        const second = await createGroup({ extended: true });
        await addMembers(first.id, 2, 'first');
        await addMembers(second.id, 2, 'second');

        const response = await request.delete('/4_0_0/Group?type=person').set(getHeaders());

        expect(response.status).toBe(400);
        expect(response.body.resourceType).toBe('OperationOutcome');
        expect(response.body.issue[0].code).toBe('too-costly');
        const groupCollection = await getCollection(GROUP_COLLECTION_NAME);
        expect(await groupCollection.countDocuments({ id: { $in: [first.id, second.id] } })).toBe(2);
        const memberCollection = await getCollection(GROUP_MEMBER_COLLECTION_NAME);
        expect(await memberCollection.countDocuments({})).toBe(4);
    });

    test('deleting an extended Group with ENABLE_EXTENDED_GROUP off is rejected and deletes nothing', async () => {
        const created = await createGroup({ extended: true });
        await addMembers(created.id, 2);
        const groupUuid = await groupUuidOf(created.id);
        setExtendedGroupEnabled(false);
        try {
            const response = await request.delete(`/4_0_0/Group/${created.id}`).set(getHeaders());

            expect(response.status).toBe(400);
        } finally {
            setExtendedGroupEnabled(true);
        }
        const groupCollection = await getCollection(GROUP_COLLECTION_NAME);
        expect(await groupCollection.findOne({ id: created.id })).not.toBeNull();
        expect(await liveMemberCount(groupUuid)).toBe(2);
    });

    test('deleting an embedded Group takes the normal path: no cascade and no GroupMember history', async () => {
        const created = await createGroup({ extended: false });
        const groupUuid = await groupUuidOf(created.id);

        const response = await deleteGroup(created.id);

        expect([200, 204]).toContain(response.status);
        const groupCollection = await getCollection(GROUP_COLLECTION_NAME);
        expect(await groupCollection.findOne({ id: created.id })).toBeNull();
        expect(await memberTombstones(groupUuid)).toHaveLength(0);
    });

    test('cascade deletes only the target Group\'s rows, never another Group\'s', async () => {
        const target = await createGroup({ extended: true });
        const other = await createGroup({ extended: true });
        await addMembers(target.id, 2, 'target');
        await addMembers(other.id, 2, 'other');
        const otherUuid = await groupUuidOf(other.id);

        await deleteGroup(target.id);

        expect(await liveMemberCount(otherUuid)).toBe(2);
        expect(await memberTombstones(otherUuid)).toHaveLength(0);
    });
});
