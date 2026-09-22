/**
 * Group promotion to extended member storage (DCON-5528)
 *
 * Once a Group's member[] crosses configManager.groupMemberLimit, promoteNewGroupIfNeeded /
 * promoteExistingGroupIfNeeded (src/utils/groupPromotion.js) promote it: called directly from the
 * write paths that can produce a qualifying Group -- create.js, update.js (both branches),
 * patch.js (the embedded-regime branch), and mergeManager.js (both branches) -- right before each
 * one's own insertOneAsync/replaceOneAsync/mergeOneAsync call. Promotion first bulk-writes the
 * roster into GroupMember_4_0_0 (via the same MongoGroupMemberRepository the PATCH write path
 * already uses -- see group_member_patch_write.test.js), then -- only once that succeeds --
 * mutates the in-memory doc (unsets member[], sets MONGO_GROUP_EXTENDED_FIELD/_extended: true)
 * that the caller is about to persist, so the strip+flag rides along in the SAME physical write and the SAME
 * meta.versionId bump the caller already intended, rather than a second, separately-versioned
 * write.
 *
 * There is no member-count reject anywhere -- including CREATE. A Group that arrives already
 * over the limit is promoted on its first save, exactly like one that crosses the limit later via
 * PUT, $merge, or PATCH.
 *
 * ENABLE_EXTENDED_GROUP is set to '1' globally in jest/setEnvVars.js.
 */
const { describe, test, beforeAll, afterAll, beforeEach, afterEach, expect, jest } = require('@jest/globals');
const { Collection } = require('mongodb');
const { commonBeforeEach, commonAfterEach, createTestRequest, getTestContainer, getHeaders, getHeadersJsonPatch } = require('../common');
const { GROUP_MEMBER_COLLECTION_NAME, GROUP_MEMBER_HISTORY_COLLECTION_NAME } = require('../../../constants');
const { MONGO_GROUP_EXTENDED_FIELD } = require('../../../utils/mongoGroupExtendedTag');

const GROUP_COLLECTION_NAME = 'Group_4_0_0';

function defaultMeta() {
    return {
        source: 'http://test-system.com/Group',
        security: [
            { system: 'https://www.icanbwell.com/owner', code: 'test-owner' },
            { system: 'https://www.icanbwell.com/access', code: 'test-access' }
        ]
    };
}

function buildMembers(count, prefix) {
    return Array.from({ length: count }, (_, i) => ({ entity: { reference: `Patient/${prefix}-${i}` } }));
}

describe('Group promotion to extended member storage', () => {
    let request;
    let savedLimit;

    beforeAll(async () => {
        await commonBeforeEach();
        request = await createTestRequest();
    });

    afterAll(async () => {
        await commonAfterEach();
    });

    beforeEach(() => {
        savedLimit = process.env.MAX_GROUP_MEMBERS_PER_PUT;
    });

    afterEach(() => {
        if (savedLimit === undefined) {
            delete process.env.MAX_GROUP_MEMBERS_PER_PUT;
        } else {
            process.env.MAX_GROUP_MEMBERS_PER_PUT = savedLimit;
        }
    });

    async function getCollection(name) {
        const container = getTestContainer();
        const db = await container.mongoDatabaseManager.getClientDbAsync();
        return db.collection(name);
    }

    async function createGroup(overrides = {}) {
        return request
            .post('/4_0_0/Group')
            .send({
                resourceType: 'Group',
                type: 'person',
                actual: true,
                meta: defaultMeta(),
                ...overrides
            })
            .set(getHeaders());
    }

    async function patchGroup(groupId, patchOps) {
        return request
            .patch(`/4_0_0/Group/${groupId}`)
            .send(patchOps)
            .set(getHeadersJsonPatch());
    }

    async function getGroupDoc(groupId) {
        const groupCollection = await getCollection(GROUP_COLLECTION_NAME);
        return groupCollection.findOne({ id: groupId });
    }

    async function getMemberRows(groupUuid) {
        const memberCollection = await getCollection(GROUP_MEMBER_COLLECTION_NAME);
        return memberCollection.find({ groupUuid }).toArray();
    }

    async function expectPromoted(groupId, expectedRosterSize) {
        const groupDoc = await getGroupDoc(groupId);
        expect(groupDoc[MONGO_GROUP_EXTENDED_FIELD]).toBe(true);
        expect(groupDoc.member).toBeUndefined();

        const rows = await getMemberRows(groupDoc._uuid);
        expect(rows).toHaveLength(expectedRosterSize);
    }

    /**
     * History writes are deferred to after the HTTP response (PostRequestProcessor), so poll
     * for the expected count instead of assuming it's already there.
     */
    async function waitForHistoryRowsAsync(historyCollection, query, expectedLength, timeoutMs = 5000) {
        const start = Date.now();
        let rows = await historyCollection.find(query).toArray();
        while (rows.length < expectedLength && Date.now() - start < timeoutMs) {
            await new Promise((resolve) => setTimeout(resolve, 100));
            rows = await historyCollection.find(query).toArray();
        }
        return rows;
    }

    describe('CREATE', () => {
        test('member[] already over the limit succeeds (no reject) and promotes', async () => {
            process.env.MAX_GROUP_MEMBERS_PER_PUT = '3';
            const members = buildMembers(4, 'create-over-limit');

            const createResp = await createGroup({ member: members });
            expect(createResp.status).toBe(201);

            await expectPromoted(createResp.body.id, 4);
        });

        test('via $merge with member[] already over the limit succeeds (no reject) and promotes', async () => {
            process.env.MAX_GROUP_MEMBERS_PER_PUT = '3';
            const groupId = 'create-via-merge-over-limit';
            const members = buildMembers(4, 'create-merge-over-limit');

            const mergeResp = await request
                .post('/4_0_0/Group/$merge')
                .send({
                    resourceType: 'Group',
                    id: groupId,
                    type: 'person',
                    actual: true,
                    meta: defaultMeta(),
                    member: members
                })
                .set(getHeaders());
            expect(mergeResp.status).toBe(200);

            await expectPromoted(groupId, 4);
        });
    });

    describe('existing Group crossing the limit', () => {
        test('PUT with 5 more members over a 50-member limit (49 -> 54) succeeds and promotes', async () => {
            process.env.MAX_GROUP_MEMBERS_PER_PUT = '50';
            const created = await createGroup({ member: buildMembers(49, 'put-cross') });
            expect(created.status).toBe(201);

            const allMembers = [...buildMembers(49, 'put-cross'), ...buildMembers(5, 'put-cross-new')];
            const putResp = await request
                .put(`/4_0_0/Group/${created.body.id}`)
                .send({
                    resourceType: 'Group',
                    id: created.body.id,
                    type: 'person',
                    actual: true,
                    meta: defaultMeta(),
                    member: allMembers
                })
                .set(getHeaders());
            expect(putResp.status).toBe(200);

            await expectPromoted(created.body.id, 54);
        });

        test('$merge with the full updated member[] crossing the limit succeeds and promotes', async () => {
            process.env.MAX_GROUP_MEMBERS_PER_PUT = '3';
            const created = await createGroup({ member: buildMembers(2, 'merge-cross') });
            expect(created.status).toBe(201);

            const allMembers = [...buildMembers(2, 'merge-cross'), ...buildMembers(2, 'merge-cross-new')];
            const mergeResp = await request
                .post('/4_0_0/Group/$merge')
                .send({
                    resourceType: 'Group',
                    id: created.body.id,
                    type: 'person',
                    actual: true,
                    meta: defaultMeta(),
                    member: allMembers
                })
                .set(getHeaders());
            expect(mergeResp.status).toBe(200);

            await expectPromoted(created.body.id, 4);
        });

        test('standard PATCH add ops on an embedded Group crossing the limit succeed and promote', async () => {
            process.env.MAX_GROUP_MEMBERS_PER_PUT = '3';
            const created = await createGroup({ member: buildMembers(2, 'patch-cross') });
            expect(created.status).toBe(201);

            const patchResp = await patchGroup(created.body.id, [
                { op: 'add', path: '/member/-', value: { entity: { reference: 'Patient/patch-cross-new-0' } } },
                { op: 'add', path: '/member/-', value: { entity: { reference: 'Patient/patch-cross-new-1' } } }
            ]);
            expect(patchResp.status).toBe(200);

            await expectPromoted(created.body.id, 4);
        });
    });

    describe('already extended', () => {
        test('a further PATCH add on an already-promoted Group does not re-promote', async () => {
            process.env.MAX_GROUP_MEMBERS_PER_PUT = '3';
            const created = await createGroup({ member: buildMembers(4, 'no-repromote') });
            expect(created.status).toBe(201);
            await expectPromoted(created.body.id, 4);
            const groupDocAfterFirstPromotion = await getGroupDoc(created.body.id);
            const firstVersionId = groupDocAfterFirstPromotion.meta.versionId;

            const patchResp = await patchGroup(created.body.id, [
                { op: 'add', path: '/member/-', value: { entity: { reference: 'Patient/no-repromote-extra' } } }
            ]);
            expect(patchResp.status).toBe(200);

            const groupDoc = await getGroupDoc(created.body.id);
            expect(groupDoc[MONGO_GROUP_EXTENDED_FIELD]).toBe(true);
            expect(groupDoc.member).toBeUndefined();
            // Metadata-only PATCH write on an already-extended Group still bumps versionId once,
            // via the ordinary write path -- it just never re-enters promoteExistingGroupIfNeeded's
            // promotion branch again (doc[MONGO_GROUP_EXTENDED_FIELD] === true short-circuits it).
            expect(parseInt(groupDoc.meta.versionId, 10)).toBeGreaterThan(parseInt(firstVersionId, 10));

            const rows = await getMemberRows(groupDoc._uuid);
            expect(rows).toHaveLength(5);
        });
    });

    describe('crash recovery', () => {
        test('a failure in the outer Group write leaves the roster durably written; the next write completes promotion', async () => {
            process.env.MAX_GROUP_MEMBERS_PER_PUT = '3';

            // Create under the limit first (no promotion attempted), so a failed update below
            // leaves this pre-existing, known document in place -- unlike a failed create, which
            // would leave nothing to look up a groupUuid from at all.
            const created = await createGroup({ member: buildMembers(2, 'crash-recovery') });
            expect(created.status).toBe(201);
            const groupId = created.body.id;

            const realBulkWrite = Collection.prototype.bulkWrite;
            let thrown = false;
            jest.spyOn(Collection.prototype, 'bulkWrite').mockImplementation(function (operations, options) {
                // Only the OUTER Group_4_0_0 write fails -- the roster write inside
                // promoteExistingGroupIfNeeded targets GroupMember_4_0_0 and must succeed, since
                // it runs (and is awaited) BEFORE this failing call even happens.
                if (this.collectionName === GROUP_COLLECTION_NAME && !thrown) {
                    thrown = true;
                    return Promise.reject(new Error('simulated crash after roster write, before Group document commit'));
                }
                return realBulkWrite.call(this, operations, options);
            });

            try {
                const putResp = await request
                    .put(`/4_0_0/Group/${groupId}`)
                    .send({
                        resourceType: 'Group',
                        id: groupId,
                        type: 'person',
                        actual: true,
                        meta: defaultMeta(),
                        member: buildMembers(4, 'crash-recovery')
                    })
                    .set(getHeaders());
                expect(putResp.status).toBeGreaterThanOrEqual(500);
                expect(thrown).toBe(true);

                // The Group document never committed, so it still shows its pre-update state --
                // but the roster write already ran (and was awaited) before the failing call.
                const groupDocAfterCrash = await getGroupDoc(groupId);
                expect(groupDocAfterCrash[MONGO_GROUP_EXTENDED_FIELD]).not.toBe(true);
                expect(groupDocAfterCrash.member).toHaveLength(2);
                const rowsAfterCrash = await getMemberRows(groupDocAfterCrash._uuid);
                expect(rowsAfterCrash).toHaveLength(4);

                // Retrying the same PUT re-enters promoteExistingGroupIfNeeded; the roster write
                // resolves every row back to 'none' (already current, no duplicates) and this
                // time the Group document's own commit succeeds, completing promotion.
                const retryResp = await request
                    .put(`/4_0_0/Group/${groupId}`)
                    .send({
                        resourceType: 'Group',
                        id: groupId,
                        type: 'person',
                        actual: true,
                        meta: defaultMeta(),
                        member: buildMembers(4, 'crash-recovery')
                    })
                    .set(getHeaders());
                expect(retryResp.status).toBe(200);

                await expectPromoted(groupId, 4);
            } finally {
                Collection.prototype.bulkWrite.mockRestore();
            }
        });
    });

    describe('ClickHouse-tracked Group', () => {
        // Safe to flip these env vars mid-file, inside a single test: isGroupOverLimit (called by
        // both promoteNewGroupIfNeeded/promoteExistingGroupIfNeeded) reads
        // configManager.enableClickHouse/mongoWithClickHouseResources fresh on every call (unlike
        // the old PostSaveHandler-based design, whose handler list was frozen once when
        // postSaveProcessor was first resolved by the shared test app/container).
        test('is skipped entirely -- member[] stays inline, no promotion attempted', async () => {
            process.env.MAX_GROUP_MEMBERS_PER_PUT = '3';
            const savedEnableClickHouse = process.env.ENABLE_CLICKHOUSE;
            const savedResources = process.env.MONGO_WITH_CLICKHOUSE_RESOURCES;
            process.env.ENABLE_CLICKHOUSE = '1';
            process.env.MONGO_WITH_CLICKHOUSE_RESOURCES = 'Group';
            try {
                const created = await createGroup({ member: buildMembers(4, 'clickhouse-skip') });
                expect(created.status).toBe(201);

                const groupDoc = await getGroupDoc(created.body.id);
                expect(groupDoc[MONGO_GROUP_EXTENDED_FIELD]).not.toBe(true);
                expect(groupDoc.member).toHaveLength(4);
                const rows = await getMemberRows(groupDoc._uuid);
                expect(rows).toHaveLength(0);
            } finally {
                if (savedEnableClickHouse === undefined) {
                    delete process.env.ENABLE_CLICKHOUSE;
                } else {
                    process.env.ENABLE_CLICKHOUSE = savedEnableClickHouse;
                }
                if (savedResources === undefined) {
                    delete process.env.MONGO_WITH_CLICKHOUSE_RESOURCES;
                } else {
                    process.env.MONGO_WITH_CLICKHOUSE_RESOURCES = savedResources;
                }
            }
        });
    });

    describe('versionId/lastUpdated parity across Group, GroupMember, and their history', () => {
        test('Group at version 4 with 4 inline members, promoted by a PATCH adding 50 more (54 total): every GroupMember row and both history collections land at version 5 with the Group\'s own lastUpdated', async () => {
            process.env.MAX_GROUP_MEMBERS_PER_PUT = '50';

            // v1: create with 4 inline members -- well under the 50-member limit.
            const created = await createGroup({ member: buildMembers(4, 'parity') });
            expect(created.status).toBe(201);
            expect(created.body.meta.versionId).toBe('1');
            const groupId = created.body.id;

            // v2 -> v4: three metadata-only bumps that never touch /member, to reach version 4
            // with the roster still at 4 embedded members, matching the exact scenario asked for.
            let lastResp;
            lastResp = await patchGroup(groupId, [{ op: 'add', path: '/active', value: true }]);
            expect(lastResp.status).toBe(200);
            lastResp = await patchGroup(groupId, [{ op: 'replace', path: '/active', value: false }]);
            expect(lastResp.status).toBe(200);
            lastResp = await patchGroup(groupId, [{ op: 'replace', path: '/active', value: true }]);
            expect(lastResp.status).toBe(200);
            expect(lastResp.body.meta.versionId).toBe('4');

            // v5: add 50 more members -- 4 existing + 50 new = 54, crossing the 50-member limit.
            // Since the Group has never been promoted before, all 54 (not just the 50 new ones)
            // are freshly created GroupMember_4_0_0 rows by this one write.
            const newMemberPatchOps = buildMembers(50, 'parity-new').map((member) => ({
                op: 'add', path: '/member/-', value: member
            }));
            const patchResp = await patchGroup(groupId, newMemberPatchOps);
            expect(patchResp.status).toBe(200);
            expect(patchResp.body.meta.versionId).toBe('5');
            expect(patchResp.body.member).toBeUndefined();

            const expectedLastUpdated = new Date(patchResp.body.meta.lastUpdated).toISOString();

            const groupDoc = await getGroupDoc(groupId);
            expect(groupDoc[MONGO_GROUP_EXTENDED_FIELD]).toBe(true);
            expect(groupDoc.meta.versionId).toBe('5');
            expect(new Date(groupDoc.meta.lastUpdated).toISOString()).toBe(expectedLastUpdated);

            // Live GroupMember_4_0_0 rows: all 54, every one stamped with the Group's own new
            // version and lastUpdated -- not a per-row timestamp of when each was written.
            const memberRows = await getMemberRows(groupDoc._uuid);
            expect(memberRows).toHaveLength(54);
            for (const row of memberRows) {
                expect(row.meta.versionId).toBe('5');
                expect(new Date(row.meta.lastUpdated).toISOString()).toBe(expectedLastUpdated);
            }

            // Group's own history row for version 5.
            const groupHistoryCollection = await getCollection(`${GROUP_COLLECTION_NAME}_History`);
            const groupHistoryRows = await waitForHistoryRowsAsync(
                groupHistoryCollection,
                { 'resource._uuid': groupDoc._uuid, 'resource.meta.versionId': '5' },
                1
            );
            expect(groupHistoryRows).toHaveLength(1);
            expect(new Date(groupHistoryRows[0].resource.meta.lastUpdated).toISOString()).toBe(expectedLastUpdated);

            // GroupMember history: 54 fresh 'create' rows (this Group was never promoted before,
            // so none of these are updates to a pre-existing row), every one at version 5 with the
            // same lastUpdated as the Group and its own history row above.
            const memberHistoryCollection = await getCollection(GROUP_MEMBER_HISTORY_COLLECTION_NAME);
            const memberHistoryRows = await waitForHistoryRowsAsync(
                memberHistoryCollection,
                { 'resource.groupUuid': groupDoc._uuid },
                54
            );
            expect(memberHistoryRows).toHaveLength(54);
            for (const historyRow of memberHistoryRows) {
                expect(historyRow.resource.meta.versionId).toBe('5');
                expect(new Date(historyRow.resource.meta.lastUpdated).toISOString()).toBe(expectedLastUpdated);
            }
        });

        test('a $merge update crossing the limit also keeps Group, GroupMember, and both history collections in parity', async () => {
            process.env.MAX_GROUP_MEMBERS_PER_PUT = '3';
            const created = await createGroup({ member: buildMembers(2, 'parity-merge') });
            expect(created.status).toBe(201);
            const groupId = created.body.id;

            const allMembers = [...buildMembers(2, 'parity-merge'), ...buildMembers(3, 'parity-merge-new')];
            const mergeResp = await request
                .post('/4_0_0/Group/$merge')
                .send({
                    resourceType: 'Group',
                    id: groupId,
                    type: 'person',
                    actual: true,
                    meta: defaultMeta(),
                    member: allMembers
                })
                .set(getHeaders());
            expect(mergeResp.status).toBe(200);

            // $merge's response is a MergeResultEntry bundle, not the resource itself -- read the
            // persisted Group directly, same as the existing $merge promotion tests above do.
            const groupDoc = await getGroupDoc(groupId);
            expect(groupDoc[MONGO_GROUP_EXTENDED_FIELD]).toBe(true);
            expect(Number(groupDoc.meta.versionId)).toBe(2);
            const expectedLastUpdated = new Date(groupDoc.meta.lastUpdated).toISOString();

            const memberRows = await getMemberRows(groupDoc._uuid);
            expect(memberRows).toHaveLength(5);
            for (const row of memberRows) {
                expect(row.meta.versionId).toBe(groupDoc.meta.versionId);
                expect(new Date(row.meta.lastUpdated).toISOString()).toBe(expectedLastUpdated);
            }

            const groupHistoryCollection = await getCollection(`${GROUP_COLLECTION_NAME}_History`);
            const groupHistoryRows = await waitForHistoryRowsAsync(
                groupHistoryCollection,
                { 'resource._uuid': groupDoc._uuid, 'resource.meta.versionId': groupDoc.meta.versionId },
                1
            );
            expect(groupHistoryRows).toHaveLength(1);
            expect(new Date(groupHistoryRows[0].resource.meta.lastUpdated).toISOString()).toBe(expectedLastUpdated);

            const memberHistoryCollection = await getCollection(GROUP_MEMBER_HISTORY_COLLECTION_NAME);
            const memberHistoryRows = await waitForHistoryRowsAsync(
                memberHistoryCollection,
                { 'resource.groupUuid': groupDoc._uuid },
                5
            );
            expect(memberHistoryRows).toHaveLength(5);
            for (const historyRow of memberHistoryRows) {
                expect(historyRow.resource.meta.versionId).toBe(groupDoc.meta.versionId);
                expect(new Date(historyRow.resource.meta.lastUpdated).toISOString()).toBe(expectedLastUpdated);
            }
        });
    });
});
