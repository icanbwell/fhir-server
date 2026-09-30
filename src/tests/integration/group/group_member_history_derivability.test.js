/**
 * EA-2324 / DCON-5530 evidence test: can the membership lifecycle event type (create / update /
 * delete / re-create / deactivate / reactivate) be reconstructed from GroupMember_4_0_0_History
 * ALONE, with nothing added at write time?
 *
 * Premises this test exercises, all of which are properties of the existing code:
 *  - Every history row is a FULL post-write snapshot of the membership document
 *    (fastDatabaseBulkInserter.insertOneHistoryAsync: `resource: doc`).
 *  - request.method is 'PATCH' for both a create and an update, and 'DELETE' only for a
 *    hard-remove tombstone (mongoGroupMemberRepository.js:207-220 clones requestInfo with
 *    method 'DELETE').
 *  - resource.meta.versionId is the owning GROUP's versionId at write time, and patch.js:515
 *    forces a Group version bump for every member-affecting PATCH -- so versionId is a strictly
 *    increasing per-request commit sequence, and a member is touched at most once per commit
 *    (resolveMemberWritesAsync de-dupes by member _uuid).
 *  - A resolved no-op writes no history row at all.
 *
 * If reconstruction succeeds, "the event type cannot be backfilled from history" is false.
 */
const { describe, test, beforeAll, afterAll, expect } = require('@jest/globals');
const {
    commonBeforeEach,
    commonAfterEach,
    createTestRequest,
    getTestContainer,
    getHeaders,
    getHeadersJsonPatch
} = require('../common');
const {
    GROUP_MEMBER_COLLECTION_NAME,
    GROUP_MEMBER_HISTORY_COLLECTION_NAME
} = require('../../../constants');
const { MONGO_GROUP_EXTENDED_FIELD } = require('../../../utils/mongoGroupExtendedTag');

const GROUP_COLLECTION_NAME = 'Group_4_0_0';

/**
 * The whole proposed-ask-under-test, implemented as a pure function of history rows.
 * Takes every GroupMember_4_0_0_History row for ONE member _uuid and returns the ordered
 * lifecycle. No extra persisted field is used.
 */
function deriveLifecycle(historyRowsForOneMember) {
    const ordered = [...historyRowsForOneMember].sort(
        (a, b) => parseInt(a.resource.meta.versionId, 10) - parseInt(b.resource.meta.versionId, 10)
    );

    const events = [];
    let live = false; // is the membership document currently present?
    let previousSnapshot = null;

    for (const row of ordered) {
        const snapshot = row.resource;
        const version = parseInt(snapshot.meta.versionId, 10);

        if (row.request.method === 'DELETE') {
            events.push({ version, event: 'delete' });
            live = false;
            previousSnapshot = null;
            continue;
        }

        if (!live) {
            // First-ever row, or the first row after a DELETE tombstone.
            events.push({ version, event: previousSnapshot === null && events.length === 0 ? 'create' : 're-create' });
        } else {
            const before = previousSnapshot.member.inactive;
            const after = snapshot.member.inactive;
            if (before !== true && after === true) {
                events.push({ version, event: 'deactivate' });
            } else if (before === true && after !== true) {
                events.push({ version, event: 'reactivate' });
            } else {
                events.push({ version, event: 'update' });
            }
        }
        live = true;
        previousSnapshot = snapshot;
    }

    return events;
}

describe('GroupMember_4_0_0_History lifecycle derivability (DCON-5530)', () => {
    let request;

    beforeAll(async () => {
        await commonBeforeEach();
        request = await createTestRequest();
    });

    afterAll(async () => {
        await commonAfterEach();
    });

    async function getCollection(name) {
        const container = getTestContainer();
        const db = await container.mongoDatabaseManager.getClientDbAsync();
        return db.collection(name);
    }

    async function createGroup() {
        const response = await request
            .post('/4_0_0/Group')
            .send({
                resourceType: 'Group',
                type: 'person',
                actual: true,
                meta: {
                    source: 'http://test-system.com/Group',
                    security: [
                        { system: 'https://www.icanbwell.com/owner', code: 'test-owner' },
                        { system: 'https://www.icanbwell.com/access', code: 'test-access' }
                    ]
                }
            })
            .set(getHeaders());
        expect(response.status).toBe(201);
        return response.body;
    }

    async function markGroupExtended(groupId) {
        const groupCollection = await getCollection(GROUP_COLLECTION_NAME);
        await groupCollection.updateOne(
            { id: groupId },
            { $set: { [MONGO_GROUP_EXTENDED_FIELD]: true } }
        );
    }

    async function patchGroup(groupId, patchOps) {
        return await request
            .patch(`/4_0_0/Group/${groupId}`)
            .send(patchOps)
            .set(getHeadersJsonPatch());
    }

    async function waitForHistoryRowsAsync(historyCollection, groupUuid, expectedLength, timeoutMs = 10000) {
        const start = Date.now();
        const query = { 'resource.groupUuid': groupUuid };
        let rows = await historyCollection.find(query).toArray();
        while (rows.length < expectedLength && Date.now() - start < timeoutMs) {
            await new Promise((resolve) => setTimeout(resolve, 100));
            rows = await historyCollection.find(query).toArray();
        }
        return rows;
    }

    test('a full create/update/deactivate/reactivate/delete/re-create sequence is reconstructable from history alone', async () => {
        const created = await createGroup();
        await markGroupExtended(created.id);
        const memberRef = 'Patient/derivability-subject';

        const add = (value) => [{ op: 'add', path: '/member/-', value }];
        const remove = () => [{ op: 'remove', path: '/member/', value: { entity: { reference: memberRef } } }];

        // 1. create
        expect((await patchGroup(created.id, add({ entity: { reference: memberRef } }))).status).toBe(200);
        // 2. update (period changes; inactive stays unset)
        expect(
            (await patchGroup(created.id, add({ entity: { reference: memberRef }, period: { start: '2026-01-01' } }))).status
        ).toBe(200);
        // 3. deactivate (explicit inactive: true -- soft, row survives)
        expect(
            (await patchGroup(created.id, add({ entity: { reference: memberRef }, period: { start: '2026-01-01' }, inactive: true }))).status
        ).toBe(200);
        // 4. reactivate (bare re-add: resolveInactive turns unset -> false when the row had it set)
        expect(
            (await patchGroup(created.id, add({ entity: { reference: memberRef }, period: { start: '2026-01-01' } }))).status
        ).toBe(200);
        // 5. delete (hard remove -> tombstone with request.method DELETE)
        expect((await patchGroup(created.id, remove())).status).toBe(200);
        // 6. re-create (same entity, so the same deterministic member _uuid)
        expect((await patchGroup(created.id, add({ entity: { reference: memberRef } }))).status).toBe(200);

        const memberCollection = await getCollection(GROUP_MEMBER_COLLECTION_NAME);
        const liveRow = await memberCollection.findOne({ 'member.entity.reference': memberRef });
        expect(liveRow).not.toBeNull();
        const { groupUuid } = liveRow;
        const memberUuid = liveRow._uuid;

        const historyCollection = await getCollection(GROUP_MEMBER_HISTORY_COLLECTION_NAME);
        const allRows = await waitForHistoryRowsAsync(historyCollection, groupUuid, 6);

        // All six writes produced a history row, all for the one deterministic member _uuid.
        expect(allRows).toHaveLength(6);
        const rowsForMember = allRows.filter((r) => r.resource._uuid === memberUuid);
        expect(rowsForMember).toHaveLength(6);

        // Every row is a full snapshot, not a diff: the membership payload is present on each.
        for (const row of rowsForMember) {
            expect(row.resource.member.entity.reference).toBeDefined();
            expect(row.resource.groupUuid).toBe(groupUuid);
            expect(row.resource.meta.versionId).toBeDefined();
            // A correlation id IS already persisted on every history row.
            expect(row.request.id).toBeDefined();
        }

        // request.method alone is 5x PATCH + 1x DELETE -- it does NOT distinguish create/update.
        const methods = rowsForMember.map((r) => r.request.method).sort();
        expect(methods).toEqual(['DELETE', 'PATCH', 'PATCH', 'PATCH', 'PATCH', 'PATCH']);

        // versionId is a usable total order for this member: 6 rows, 6 distinct versions.
        const versions = rowsForMember.map((r) => parseInt(r.resource.meta.versionId, 10));
        expect(new Set(versions).size).toBe(6);
        expect([...versions].sort((a, b) => a - b)).toEqual(versions.slice().sort((a, b) => a - b));

        // THE POINT: the full lifecycle falls out of the snapshots + method + version order.
        const derived = deriveLifecycle(rowsForMember).map((e) => e.event);
        expect(derived).toEqual([
            'create',
            'update',
            'deactivate',
            'reactivate',
            'delete',
            're-create'
        ]);
    });

    test('a resolved no-op writes no history row, so derivation sees no phantom event', async () => {
        const created = await createGroup();
        await markGroupExtended(created.id);
        const memberRef = 'Patient/derivability-noop';

        await patchGroup(created.id, [
            { op: 'add', path: '/member/-', value: { entity: { reference: memberRef } } }
        ]);
        const memberCollection = await getCollection(GROUP_MEMBER_COLLECTION_NAME);
        const liveRow = await memberCollection.findOne({ 'member.entity.reference': memberRef });
        const { groupUuid } = liveRow;

        const historyCollection = await getCollection(GROUP_MEMBER_HISTORY_COLLECTION_NAME);
        await waitForHistoryRowsAsync(historyCollection, groupUuid, 1);

        // Identical re-add -> resolveMemberWrite returns 'none'.
        await patchGroup(created.id, [
            { op: 'add', path: '/member/-', value: { entity: { reference: memberRef } } }
        ]);
        // Remove of an absent member -> 'none'.
        await patchGroup(created.id, [
            { op: 'remove', path: '/member/', value: { entity: { reference: 'Patient/never-added' } } }
        ]);

        await new Promise((resolve) => setTimeout(resolve, 750));
        const rows = await historyCollection.find({ 'resource.groupUuid': groupUuid }).toArray();
        expect(rows).toHaveLength(1);
        expect(deriveLifecycle(rows).map((e) => e.event)).toEqual(['create']);
    });

    test('one PATCH touching many members stamps one shared versionId, but (memberUuid, versionId) stays unique', async () => {
        const created = await createGroup();
        await markGroupExtended(created.id);

        const refs = Array.from({ length: 25 }, (_, i) => `Patient/derivability-bulk-${i}`);
        const resp = await patchGroup(
            created.id,
            refs.map((reference) => ({ op: 'add', path: '/member/-', value: { entity: { reference } } }))
        );
        expect(resp.status).toBe(200);

        const memberCollection = await getCollection(GROUP_MEMBER_COLLECTION_NAME);
        const liveRow = await memberCollection.findOne({ 'member.entity.reference': refs[0] });
        const { groupUuid } = liveRow;

        const historyCollection = await getCollection(GROUP_MEMBER_HISTORY_COLLECTION_NAME);
        const rows = await waitForHistoryRowsAsync(historyCollection, groupUuid, refs.length);
        expect(rows).toHaveLength(refs.length);

        // Every row shares the Group's single versionId/lastUpdated for this commit...
        const versionIds = new Set(rows.map((r) => r.resource.meta.versionId));
        expect(versionIds.size).toBe(1);
        expect([...versionIds][0]).toBe(resp.body.meta.versionId);
        const lastUpdateds = new Set(rows.map((r) => new Date(r.resource.meta.lastUpdated).toISOString()));
        expect(lastUpdateds.size).toBe(1);

        // ...and each member appears exactly once in that commit, so the composite key is unique.
        const compositeKeys = rows.map((r) => `${r.resource._uuid}|${r.resource.meta.versionId}`);
        expect(new Set(compositeKeys).size).toBe(refs.length);

        // Each one derives as a 'create'.
        for (const row of rows) {
            expect(deriveLifecycle([row]).map((e) => e.event)).toEqual(['create']);
        }
    });
});
