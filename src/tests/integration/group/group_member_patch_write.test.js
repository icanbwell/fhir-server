/**
 * Group member PATCH write path (DCON-5527)
 *
 * Roster changes for a Group go exclusively through standard PATCH /4_0_0/Group/{id} with
 * RFC 6902 JSON Patch ops on /member -- there is no more $member-add/$member-remove operation.
 * GroupMemberPatchStrategy.determineGroupMemberType() picks the group member type once the Group is loaded:
 * - embedded (default): zero special-casing, ops flow through the ordinary fast-json-patch flow.
 * - mongoNative ("extended", DCON-5527): rows are written to GroupMember_4_0_0 /
 *   GroupMember_4_0_0_History via MongoGroupMemberRepository.
 *
 * ENABLE_EXTENDED_GROUP is set to '1' globally in jest/setEnvVars.js.
 */
const { describe, test, beforeAll, afterAll, expect } = require('@jest/globals');
const { commonBeforeEach, commonAfterEach, createTestRequest, getTestContainer, getHeaders, getHeadersJsonPatch } = require('../common');
const { GROUP_MEMBER_COLLECTION_NAME, GROUP_MEMBER_HISTORY_COLLECTION_NAME } = require('../../../constants');
const { assertTooCostlyOperationOutcome, getMaxPatchOperations } = require('./groupTestHelpers');
const { MONGO_GROUP_EXTENDED_FIELD } = require('../../../utils/mongoGroupExtendedTag');

const GROUP_COLLECTION_NAME = 'Group_4_0_0';

function defaultMeta(extraTags = []) {
    return {
        source: 'http://test-system.com/Group',
        security: [
            { system: 'https://www.icanbwell.com/owner', code: 'test-owner' },
            { system: 'https://www.icanbwell.com/access', code: 'test-access' }
        ],
        tag: extraTags
    };
}

describe('Group member PATCH write path (DCON-5527)', () => {
    let request;

    beforeAll(async () => {
        await commonBeforeEach();
        request = await createTestRequest();
    });

    afterAll(async () => {
        await commonAfterEach();
    });

    async function createGroup(overrides = {}) {
        const response = await request
            .post('/4_0_0/Group')
            .send({
                resourceType: 'Group',
                type: 'person',
                actual: true,
                meta: defaultMeta(),
                ...overrides
            })
            .set(getHeaders());
        expect(response.status).toBe(201);
        return response.body;
    }

    async function patchGroup(groupId, patchOps) {
        return await request
            .patch(`/4_0_0/Group/${groupId}`)
            .send(patchOps)
            .set(getHeadersJsonPatch());
    }

    async function getCollection(name) {
        const container = getTestContainer();
        const db = await container.mongoDatabaseManager.getClientDbAsync();
        return db.collection(name);
    }

    /**
     * Puts a Group into the extended (Mongo-native) regime the way the design doc (§3.1, §7)
     * says tests should: a raw write of the internal, non-FHIR marker field directly on the
     * Group document -- never via meta.tag, which is not the source of truth and is never read
     * by determineGroupMemberType.
     */
    async function markGroupExtended(groupId) {
        const groupCollection = await getCollection(GROUP_COLLECTION_NAME);
        await groupCollection.updateOne(
            { id: groupId },
            { $set: { [MONGO_GROUP_EXTENDED_FIELD]: true } }
        );
    }

    /**
     * History writes are deferred to after the HTTP response (PostRequestProcessor), so poll
     * for the expected count instead of assuming it's already there.
     */
    async function waitForHistoryRowsAsync(historyCollection, idValue, expectedLength, timeoutMs = 5000, queryField = 'resource.groupUuid') {
        const start = Date.now();
        const query = { [queryField]: idValue };
        let rows = await historyCollection.find(query).toArray();
        while (rows.length < expectedLength && Date.now() - start < timeoutMs) {
            await new Promise((resolve) => setTimeout(resolve, 100));
            rows = await historyCollection.find(query).toArray();
        }
        return rows;
    }

    describe('embedded regime (default)', () => {
        test('PATCH add appends to member[] via standard JSON Patch', async () => {
            const created = await createGroup({
                member: [{ entity: { reference: 'Patient/embedded-existing' } }]
            });

            const patchResp = await patchGroup(created.id, [
                { op: 'add', path: '/member/-', value: { entity: { reference: 'Patient/embedded-new' } } }
            ]);

            expect(patchResp.status).toBe(200);
            expect(patchResp.body.member).toHaveLength(2);
            expect(patchResp.body.member[1].entity.reference).toBe('Patient/embedded-new');
        });

        test('PATCH remove by index removes from member[] (standard RFC 6902 semantics, not by reference)', async () => {
            const created = await createGroup({
                member: [
                    { entity: { reference: 'Patient/embedded-keep' } },
                    { entity: { reference: 'Patient/embedded-drop' } }
                ]
            });

            const patchResp = await patchGroup(created.id, [
                { op: 'remove', path: '/member/1' }
            ]);

            expect(patchResp.status).toBe(200);
            expect(patchResp.body.member).toHaveLength(1);
            expect(patchResp.body.member[0].entity.reference).toBe('Patient/embedded-keep');
        });
    });

    describe('extended (Mongo-native) regime', () => {
        test('PATCH add writes a GroupMember_4_0_0 row plus exactly one history entry (regression: create/update split)', async () => {
            const created = await createGroup();
            await markGroupExtended(created.id);
            const memberRef = 'Patient/extended-add-1';

            const patchResp = await patchGroup(created.id, [
                { op: 'add', path: '/member/-', value: { entity: { reference: memberRef } } }
            ]);
            expect(patchResp.status).toBe(200);
            // Metadata-only response -- the roster is not inlined for an extended Group.
            expect(patchResp.body.member).toBeUndefined();

            const memberCollection = await getCollection(GROUP_MEMBER_COLLECTION_NAME);
            const row = await memberCollection.findOne({ 'member.entity.reference': memberRef });
            expect(row).not.toBeNull();
            expect(row.member.inactive).toBe(false);

            // A GroupMember row's own meta.versionId/lastUpdated always mirror the owning Group's
            // at the time of the write -- there is no independent per-row version counter.
            expect(row.meta.versionId).toBe(patchResp.body.meta.versionId);
            expect(new Date(row.meta.lastUpdated).toISOString()).toBe(
                new Date(patchResp.body.meta.lastUpdated).toISOString()
            );

            // Regression test for the insertOneAsync/replaceOneAsync split (design doc §5.4
            // pitfall 1): a fresh add going through replaceOneAsync({upsert:true}) always
            // reports modifiedCount:0, which used to trip MongoBulkWriteExecutor's one-by-one
            // fallback and silently skip the write's automatic history entry.
            const historyCollection = await getCollection(GROUP_MEMBER_HISTORY_COLLECTION_NAME);
            const historyRows = await waitForHistoryRowsAsync(historyCollection, row.groupUuid, 1);
            expect(historyRows).toHaveLength(1);
            expect(historyRows[0].request.method).toBe('PATCH');
        });

        test('PATCH adding several new members in one request stamps them all with the same meta.versionId/lastUpdated as the Group', async () => {
            const created = await createGroup();
            await markGroupExtended(created.id);

            const patchResp = await patchGroup(created.id, [
                { op: 'add', path: '/member/-', value: { entity: { reference: 'Patient/extended-batch-1' } } },
                { op: 'add', path: '/member/-', value: { entity: { reference: 'Patient/extended-batch-2' } } },
                { op: 'add', path: '/member/-', value: { entity: { reference: 'Patient/extended-batch-3' } } }
            ]);
            expect(patchResp.status).toBe(200);

            const memberCollection = await getCollection(GROUP_MEMBER_COLLECTION_NAME);
            const rows = await memberCollection.find({
                'member.entity.reference': { $in: ['Patient/extended-batch-1', 'Patient/extended-batch-2', 'Patient/extended-batch-3'] }
            }).toArray();
            expect(rows).toHaveLength(3);

            for (const row of rows) {
                expect(row.meta.versionId).toBe(patchResp.body.meta.versionId);
                expect(new Date(row.meta.lastUpdated).toISOString()).toBe(
                    new Date(patchResp.body.meta.lastUpdated).toISOString()
                );
            }
        });

        test('PATCH add again with a different period updates the same row in place (no duplicate row)', async () => {
            const created = await createGroup();
            await markGroupExtended(created.id);
            const memberRef = 'Patient/extended-period-update';

            const addResp = await patchGroup(created.id, [
                { op: 'add', path: '/member/-', value: { entity: { reference: memberRef }, period: { start: '2026-01-01' } } }
            ]);
            expect(addResp.status).toBe(200);
            expect(addResp.body.member).toBeUndefined();

            const memberCollection = await getCollection(GROUP_MEMBER_COLLECTION_NAME);
            const rowAfterAdd = await memberCollection.findOne({ 'member.entity.reference': memberRef });
            expect(rowAfterAdd.member.period).toEqual({ start: '2026-01-01' });
            const { groupUuid } = rowAfterAdd;

            const updateResp = await patchGroup(created.id, [
                { op: 'add', path: '/member/-', value: { entity: { reference: memberRef }, period: { start: '2026-02-01', end: '2026-06-30' } } }
            ]);
            expect(updateResp.status).toBe(200);
            // Metadata-only response for the `update` classification too -- create vs. update is
            // an internal GroupMember_4_0_0 routing decision (resolveMemberWrite) and must not
            // change the shape of the Group PATCH response.
            expect(updateResp.body.member).toBeUndefined();

            const rowsForMember = await memberCollection.find({ groupUuid, 'member.entity.reference': memberRef }).toArray();
            expect(rowsForMember).toHaveLength(1);
            expect(rowsForMember[0].member.period).toEqual({ start: '2026-02-01', end: '2026-06-30' });
            expect(rowsForMember[0].member.inactive).toBe(false);

            const historyCollection = await getCollection(GROUP_MEMBER_HISTORY_COLLECTION_NAME);
            const historyRows = await waitForHistoryRowsAsync(historyCollection, groupUuid, 2);
            expect(historyRows).toHaveLength(2);
        });

        test('PATCH add with an explicit inactive:true soft-deactivates an active member without deleting the row', async () => {
            const created = await createGroup();
            await markGroupExtended(created.id);
            const memberRef = 'Patient/extended-soft-deactivate';

            const addResp = await patchGroup(created.id, [
                { op: 'add', path: '/member/-', value: { entity: { reference: memberRef } } }
            ]);
            expect(addResp.status).toBe(200);

            const memberCollection = await getCollection(GROUP_MEMBER_COLLECTION_NAME);
            const rowAfterAdd = await memberCollection.findOne({ 'member.entity.reference': memberRef });
            const { groupUuid } = rowAfterAdd;

            const deactivateResp = await patchGroup(created.id, [
                { op: 'add', path: '/member/-', value: { entity: { reference: memberRef }, inactive: true } }
            ]);
            expect(deactivateResp.status).toBe(200);

            // Unlike PATCH remove, an explicit inactive:true keeps the row -- it's a soft
            // deactivation, distinct from the hard-delete tombstone remove produces.
            const rowAfterDeactivate = await memberCollection.findOne({ groupUuid, 'member.entity.reference': memberRef });
            expect(rowAfterDeactivate).not.toBeNull();
            expect(rowAfterDeactivate.member.inactive).toBe(true);
        });

        test('PATCH add with inactive:true followed by a bare re-add reactivates the member', async () => {
            const created = await createGroup();
            await markGroupExtended(created.id);
            const memberRef = 'Patient/extended-reactivate';

            const addResp = await patchGroup(created.id, [
                { op: 'add', path: '/member/-', value: { entity: { reference: memberRef }, inactive: true } }
            ]);
            expect(addResp.status).toBe(200);

            const memberCollection = await getCollection(GROUP_MEMBER_COLLECTION_NAME);
            const rowAfterAdd = await memberCollection.findOne({ 'member.entity.reference': memberRef });
            expect(rowAfterAdd.member.inactive).toBe(true);
            const { groupUuid } = rowAfterAdd;

            const reactivateResp = await patchGroup(created.id, [
                { op: 'add', path: '/member/-', value: { entity: { reference: memberRef } } }
            ]);
            expect(reactivateResp.status).toBe(200);

            const rowAfterReactivate = await memberCollection.findOne({ groupUuid, 'member.entity.reference': memberRef });
            expect(rowAfterReactivate).not.toBeNull();
            expect(rowAfterReactivate.member.inactive).toBe(false);
        });

        test('PATCH remove hard-deletes the row and writes a DELETE tombstone history entry', async () => {
            const created = await createGroup();
            await markGroupExtended(created.id);
            const memberRef = 'Patient/extended-remove-1';

            const addResp = await patchGroup(created.id, [
                { op: 'add', path: '/member/-', value: { entity: { reference: memberRef } } }
            ]);
            expect(addResp.status).toBe(200);

            const memberCollection = await getCollection(GROUP_MEMBER_COLLECTION_NAME);
            const rowAfterAdd = await memberCollection.findOne({ 'member.entity.reference': memberRef });
            expect(rowAfterAdd).not.toBeNull();
            const { groupUuid } = rowAfterAdd;

            // The "remove by entity reference" extension lives inside executeMemberOperations
            // itself (not standard RFC 6902), so /member/ with no index is valid here.
            const removeResp = await patchGroup(created.id, [
                { op: 'remove', path: '/member/', value: { entity: { reference: memberRef } } }
            ]);
            expect(removeResp.status).toBe(200);

            const rowAfterRemove = await memberCollection.findOne({ groupUuid, 'member.entity.reference': memberRef });
            expect(rowAfterRemove).toBeNull();

            const historyCollection = await getCollection(GROUP_MEMBER_HISTORY_COLLECTION_NAME);
            const historyRows = await waitForHistoryRowsAsync(historyCollection, groupUuid, 2);
            expect(historyRows).toHaveLength(2);
            const methods = historyRows.map((h) => h.request.method).sort();
            expect(methods).toEqual(['DELETE', 'PATCH']);
            const tombstone = historyRows.find((h) => h.request.method === 'DELETE');
            // The member was added active (no explicit inactive) and removed without ever being
            // deactivated -- the tombstone must preserve that actual last-known state, not stamp
            // inactive:true purely because it's being deleted (that would be data pollution).
            expect(tombstone.resource.member.inactive).toBe(false);

            // Regression test: RemoveHelper.deleteManyAsync unconditionally overwrites
            // meta.lastUpdated with the current wall-clock time before writing history, which
            // clobbered the groupLastUpdated stamped on the tombstone doc -- breaking four-way
            // parity (Group/Group_History/GroupMember/GroupMember_History must all share the same
            // lastUpdated) specifically for the remove case. versionId was never touched by
            // deleteManyAsync, so it always matched; lastUpdated did not, until preserveLastUpdated.
            expect(tombstone.resource.meta.versionId).toBe(removeResp.body.meta.versionId);
            expect(new Date(tombstone.resource.meta.lastUpdated).toISOString()).toBe(
                new Date(removeResp.body.meta.lastUpdated).toISOString()
            );
        });

        test('PATCH remove of a member that is already gone is a no-op: does not bump the Group version or write any history', async () => {
            const created = await createGroup();
            await markGroupExtended(created.id);
            const memberRef = 'Patient/extended-remove-noop';

            // Never added, so this remove has nothing to do.
            const removeResp = await patchGroup(created.id, [
                { op: 'remove', path: '/member/', value: { entity: { reference: memberRef } } }
            ]);
            expect(removeResp.status).toBe(200);
            expect(removeResp.body.meta.versionId).toBe(created.meta.versionId);
            expect(new Date(removeResp.body.meta.lastUpdated).toISOString()).toBe(
                new Date(created.meta.lastUpdated).toISOString()
            );

            const groupCollection = await getCollection(GROUP_COLLECTION_NAME);
            const groupDoc = await groupCollection.findOne({ id: created.id });
            expect(groupDoc.meta.versionId).toBe(created.meta.versionId);

            const groupHistoryCollection = await getCollection(`${GROUP_COLLECTION_NAME}_History`);
            const groupHistoryRows = await groupHistoryCollection.find({ 'resource._uuid': groupDoc._uuid }).toArray();
            // Only the initial create's history row -- the no-op remove must not add a second one.
            expect(groupHistoryRows).toHaveLength(1);

            const memberCollection = await getCollection(GROUP_MEMBER_COLLECTION_NAME);
            expect(await memberCollection.findOne({ groupUuid: groupDoc._uuid })).toBeNull();
        });

        test('re-adding a member with identical period/type/display/inactive is a no-op: does not bump the Group version', async () => {
            const created = await createGroup();
            await markGroupExtended(created.id);
            const memberRef = 'Patient/extended-readd-noop';

            const addResp = await patchGroup(created.id, [
                { op: 'add', path: '/member/-', value: { entity: { reference: memberRef }, period: { start: '2026-01-01' } } }
            ]);
            expect(addResp.status).toBe(200);

            // Identical add again -- resolveMemberWrite should classify this 'none'.
            const reAddResp = await patchGroup(created.id, [
                { op: 'add', path: '/member/-', value: { entity: { reference: memberRef }, period: { start: '2026-01-01' } } }
            ]);
            expect(reAddResp.status).toBe(200);
            expect(reAddResp.body.meta.versionId).toBe(addResp.body.meta.versionId);
            expect(new Date(reAddResp.body.meta.lastUpdated).toISOString()).toBe(
                new Date(addResp.body.meta.lastUpdated).toISOString()
            );

            const memberCollection = await getCollection(GROUP_MEMBER_COLLECTION_NAME);
            const historyCollection = await getCollection(GROUP_MEMBER_HISTORY_COLLECTION_NAME);
            const row = await memberCollection.findOne({ 'member.entity.reference': memberRef });
            const historyRows = await historyCollection.find({ 'resource.groupUuid': row.groupUuid }).toArray();
            // Only the first add's history row -- the identical re-add must not add a second one.
            expect(historyRows).toHaveLength(1);
        });

        test('rejects PATCH on an extended Group when ENABLE_EXTENDED_GROUP is disabled', async () => {
            const created = await createGroup();
            await markGroupExtended(created.id);

            const saved = process.env.ENABLE_EXTENDED_GROUP;
            delete process.env.ENABLE_EXTENDED_GROUP;
            try {
                const patchResp = await patchGroup(created.id, [
                    { op: 'add', path: '/member/-', value: { entity: { reference: 'Patient/should-be-rejected' } } }
                ]);
                expect(patchResp.status).toBe(400);
            } finally {
                process.env.ENABLE_EXTENDED_GROUP = saved;
            }
        });

        test('a metadata-only PATCH on an extended Group still succeeds when ENABLE_EXTENDED_GROUP is disabled', async () => {
            // Rollout plan (design doc §8): nothing about the extended-storage feature activates
            // without the flag, but that only means membership PATCH ops are blocked -- a Group's
            // own fields must stay writable regardless, the same as it always was.
            const created = await createGroup({ name: 'original-name' });
            await markGroupExtended(created.id);

            const saved = process.env.ENABLE_EXTENDED_GROUP;
            delete process.env.ENABLE_EXTENDED_GROUP;
            try {
                const patchResp = await patchGroup(created.id, [
                    { op: 'replace', path: '/name', value: 'updated-name' }
                ]);
                expect(patchResp.status).toBe(200);
                expect(patchResp.body.name).toBe('updated-name');
            } finally {
                process.env.ENABLE_EXTENDED_GROUP = saved;
            }
        });

        test('a mixed PATCH (member op + non-member op) on an extended Group produces exactly one Group_4_0_0_History row and bumps the version by exactly one', async () => {
            // Regression test: executeMemberOperations used to commit the Group's meta bump
            // immediately (N -> N+1), then patch.js's normal non-member-patch flow computed and
            // committed a second bump on top of that (N+1 -> N+2) -- one PATCH request produced
            // two Group_4_0_0_History rows instead of one.
            const created = await createGroup({ name: 'before-mixed-patch' });
            await markGroupExtended(created.id);
            const startingVersionId = Number(created.meta.versionId);
            const memberRef = 'Patient/extended-mixed-1';

            const patchResp = await patchGroup(created.id, [
                { op: 'add', path: '/member/-', value: { entity: { reference: memberRef } } },
                { op: 'replace', path: '/name', value: 'after-mixed-patch' }
            ]);
            expect(patchResp.status).toBe(200);
            expect(patchResp.body.name).toBe('after-mixed-patch');
            expect(Number(patchResp.body.meta.versionId)).toBe(startingVersionId + 1);

            const memberCollection = await getCollection(GROUP_MEMBER_COLLECTION_NAME);
            const row = await memberCollection.findOne({ 'member.entity.reference': memberRef });
            expect(row).not.toBeNull();
            // Four-way parity must still hold even though the commit is now deferred/combined.
            expect(row.meta.versionId).toBe(patchResp.body.meta.versionId);
            expect(new Date(row.meta.lastUpdated).toISOString()).toBe(
                new Date(patchResp.body.meta.lastUpdated).toISOString()
            );

            const groupCollection = await getCollection(GROUP_COLLECTION_NAME);
            const groupDoc = await groupCollection.findOne({ id: created.id });
            expect(groupDoc.meta.versionId).toBe(patchResp.body.meta.versionId);
            expect(groupDoc.name).toBe('after-mixed-patch');

            const groupHistoryCollection = await getCollection(`${GROUP_COLLECTION_NAME}_History`);
            const groupHistoryRows = await waitForHistoryRowsAsync(
                groupHistoryCollection, created.id, startingVersionId + 1, 5000, 'resource.id'
            );
            // The Group's own create already wrote history row #1 (startingVersionId); this one
            // mixed PATCH must add exactly one more, not two.
            expect(groupHistoryRows).toHaveLength(startingVersionId + 1);
            const versionsInHistory = groupHistoryRows
                .map((h) => Number(h.resource.meta.versionId))
                .sort((a, b) => a - b);
            expect(versionsInHistory).toEqual(Array.from({ length: startingVersionId + 1 }, (_, i) => i + 1));
        });
    });

    describe('operation limits', () => {
        test('rejects PATCH with more member operations than GROUP_PATCH_OPERATIONS_LIMIT', async () => {
            // Op-count enforcement lives inside executeMemberOperations, which only runs for a
            // non-embedded backend -- use an extended Group so this test actually exercises it.
            const created = await createGroup();
            await markGroupExtended(created.id);
            const limit = getMaxPatchOperations();
            const operationCount = limit + 1;

            const patches = Array.from({ length: operationCount }, (_, i) => ({
                op: 'add',
                path: '/member/-',
                value: { entity: { reference: `Patient/limit-${i}` } }
            }));

            const patchResp = await patchGroup(created.id, patches);
            assertTooCostlyOperationOutcome(patchResp, operationCount, limit);
        });
    });
});
