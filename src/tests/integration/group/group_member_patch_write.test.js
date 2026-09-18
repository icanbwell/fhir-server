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
    async function waitForHistoryRowsAsync(historyCollection, groupUuid, expectedLength, timeoutMs = 5000) {
        const start = Date.now();
        let rows = await historyCollection.find({ 'resource.groupUuid': groupUuid }).toArray();
        while (rows.length < expectedLength && Date.now() - start < timeoutMs) {
            await new Promise((resolve) => setTimeout(resolve, 100));
            rows = await historyCollection.find({ 'resource.groupUuid': groupUuid }).toArray();
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

            // Regression test for the insertOneAsync/replaceOneAsync split (design doc §5.4
            // pitfall 1): a fresh add going through replaceOneAsync({upsert:true}) always
            // reports modifiedCount:0, which used to trip MongoBulkWriteExecutor's one-by-one
            // fallback and silently skip the write's automatic history entry.
            const historyCollection = await getCollection(GROUP_MEMBER_HISTORY_COLLECTION_NAME);
            const historyRows = await waitForHistoryRowsAsync(historyCollection, row.groupUuid, 1);
            expect(historyRows).toHaveLength(1);
            expect(historyRows[0].request.method).toBe('PATCH');
        });

        test('PATCH add again with a different period updates the same row in place (no duplicate row)', async () => {
            const created = await createGroup();
            await markGroupExtended(created.id);
            const memberRef = 'Patient/extended-period-update';

            const addResp = await patchGroup(created.id, [
                { op: 'add', path: '/member/-', value: { entity: { reference: memberRef }, period: { start: '2026-01-01' } } }
            ]);
            expect(addResp.status).toBe(200);

            const memberCollection = await getCollection(GROUP_MEMBER_COLLECTION_NAME);
            const rowAfterAdd = await memberCollection.findOne({ 'member.entity.reference': memberRef });
            expect(rowAfterAdd.member.period).toEqual({ start: '2026-01-01' });
            const { groupUuid } = rowAfterAdd;

            const updateResp = await patchGroup(created.id, [
                { op: 'add', path: '/member/-', value: { entity: { reference: memberRef }, period: { start: '2026-02-01', end: '2026-06-30' } } }
            ]);
            expect(updateResp.status).toBe(200);

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
            expect(tombstone.resource.member.inactive).toBe(true);
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
