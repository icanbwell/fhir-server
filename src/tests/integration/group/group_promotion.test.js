/**
 * Group promotion to extended member storage (DCON-5528)
 *
 * PATCH is the only write that promotes. Once a PATCH pushes an embedded Group's member[] over
 * configManager.groupMemberPromotionLimit, promoteExistingGroupIfNeeded (src/utils/groupPromotion.js)
 * first bulk-writes the roster into GroupMember_4_0_0 (via the same MongoGroupMemberRepository the
 * extended PATCH write path uses -- see group_member_patch_write.test.js), then -- only once that
 * succeeds -- mutates the in-memory doc (unsets member[], sets MONGO_GROUP_EXTENDED_FIELD/_extended:
 * true) that patch.js is about to persist, so the strip+flag rides along in the SAME physical write
 * and the SAME meta.versionId bump, rather than a second, separately-versioned write.
 *
 * POST, PUT and $merge never promote: when the Group's member[] (for $merge, the merged result)
 * exceeds that same configManager.groupMemberPromotionLimit, the write is rejected with too-costly,
 * pointing to PATCH. So an embedded Group never holds more than the promotion limit.
 * $merge reports that as the Group's own failed entry; the rest of the batch is unaffected.
 *
 * ENABLE_EXTENDED_GROUP is set to '1' globally in jest/setEnvVars.js.
 */
const { describe, test, beforeAll, afterAll, beforeEach, afterEach, expect, jest } = require('@jest/globals');
const { Collection } = require('mongodb');
const { commonBeforeEach, commonAfterEach, createTestRequest, getTestContainer, getHeaders, getHeadersJsonPatch } = require('../common');
const { GROUP_MEMBER_COLLECTION_NAME, GROUP_MEMBER_HISTORY_COLLECTION_NAME } = require('../../../constants');
const { MONGO_GROUP_EXTENDED_FIELD } = require('../../../utils/mongoGroupExtendedTag');
const { USE_EXTERNAL_STORAGE_HEADER } = require('../../../utils/contextDataBuilder');
const { hasExternalStorageMemberTag } = require('../../../utils/clickHouseGroupPreSave');
const { assertTooCostlyOperationOutcome } = require('./groupTestHelpers');

const GROUP_COLLECTION_NAME = 'Group_4_0_0';

function defaultMeta(source = 'http://test-system.com/Group') {
    return {
        source,
        security: [
            { system: 'https://www.icanbwell.com/owner', code: 'test-owner' },
            { system: 'https://www.icanbwell.com/access', code: 'test-access' }
        ]
    };
}

function buildMembers(count, prefix) {
    return Array.from({ length: count }, (_, i) => ({ entity: { reference: `Patient/${prefix}-${i}` } }));
}

function groupBody(groupId, members) {
    return { resourceType: 'Group', id: groupId, type: 'person', actual: true, meta: defaultMeta(), member: members };
}

function addMemberOps(references) {
    return references.map((reference) => ({ op: 'add', path: '/member/-', value: { entity: { reference } } }));
}

describe('Group promotion to extended member storage', () => {
    let request;
    let savedLimit;
    let savedPromotionLimit;

    beforeAll(async () => {
        await commonBeforeEach();
        request = await createTestRequest();
    });

    afterAll(async () => {
        await commonAfterEach();
    });

    beforeEach(() => {
        savedLimit = process.env.MAX_GROUP_MEMBERS_PER_PUT;
        savedPromotionLimit = process.env.GROUP_MEMBER_PROMOTION_LIMIT;
        // Deliberately high: POST, PUT and $merge reject on GROUP_MEMBER_PROMOTION_LIMIT, not this.
        process.env.MAX_GROUP_MEMBERS_PER_PUT = '1000';
        process.env.GROUP_MEMBER_PROMOTION_LIMIT = '3';
    });

    afterEach(() => {
        if (savedLimit === undefined) {
            delete process.env.MAX_GROUP_MEMBERS_PER_PUT;
        } else {
            process.env.MAX_GROUP_MEMBERS_PER_PUT = savedLimit;
        }
        if (savedPromotionLimit === undefined) {
            delete process.env.GROUP_MEMBER_PROMOTION_LIMIT;
        } else {
            process.env.GROUP_MEMBER_PROMOTION_LIMIT = savedPromotionLimit;
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

    async function putGroup(groupId, members) {
        return request
            .put(`/4_0_0/Group/${groupId}`)
            .send(groupBody(groupId, members))
            .set(getHeaders());
    }

    async function mergeResources(body) {
        return request.post('/4_0_0/Group/$merge').send(body).set(getHeaders());
    }

    async function getGroupDoc(groupId) {
        const groupCollection = await getCollection(GROUP_COLLECTION_NAME);
        return groupCollection.findOne({ id: groupId });
    }

    async function getMemberRows(groupUuid) {
        const memberCollection = await getCollection(GROUP_MEMBER_COLLECTION_NAME);
        return memberCollection.find({ groupUuid }).toArray();
    }

    /**
     * For a plain POST /Group (unlike $merge/PUT), the server always ignores any client-supplied
     * id and mints its own (create.js: "Per https://www.hl7.org/fhir/http.html#create, we should
     * ignore the id passed in and generate a new one") -- so a request that fails outright never
     * returns a groupUuid to look up rows by. Querying by each buildMembers() call's distinctive
     * reference prefix instead works regardless of which (unknown) groupUuid the attempt used.
     */
    async function getMemberRowsByReferencePrefix(prefix) {
        const memberCollection = await getCollection(GROUP_MEMBER_COLLECTION_NAME);
        return memberCollection.find({ 'member.entity.reference': { $regex: `^Patient/${prefix}-` } }).toArray();
    }

    async function expectPromoted(groupId, expectedRosterSize) {
        const groupDoc = await getGroupDoc(groupId);
        expect(groupDoc[MONGO_GROUP_EXTENDED_FIELD]).toBe(true);
        expect(groupDoc.member).toBeUndefined();

        const rows = await getMemberRows(groupDoc._uuid);
        expect(rows).toHaveLength(expectedRosterSize);
    }

    async function expectNotPromoted(groupId, embeddedMemberCount, expectedRowCount = 0) {
        const groupDoc = await getGroupDoc(groupId);
        expect(groupDoc[MONGO_GROUP_EXTENDED_FIELD]).not.toBe(true);
        expect(groupDoc.member).toHaveLength(embeddedMemberCount);
        expect(await getMemberRows(groupDoc._uuid)).toHaveLength(expectedRowCount);
    }

    /**
     * Creates an embedded Group at the limit (3 members), then promotes it with a PATCH adding
     * one more -- 4 GroupMember rows.
     */
    async function createPromotedGroup(prefix) {
        const created = await createGroup({ member: buildMembers(3, prefix) });
        expect(created.status).toBe(201);
        const groupId = created.body.id;

        const patchResp = await patchGroup(groupId, addMemberOps([`Patient/${prefix}-3`]));
        expect(patchResp.status).toBe(200);
        await expectPromoted(groupId, 4);
        return groupId;
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

    /**
     * Fails the next Group_4_0_0 bulk write only -- i.e. the Group's own commit, after
     * promotion or commitPendingMemberWrites has already written the roster.
     */
    function failNextGroupWrite() {
        const realBulkWrite = Collection.prototype.bulkWrite;
        const state = { thrown: false };
        jest.spyOn(Collection.prototype, 'bulkWrite').mockImplementation(function (operations, options) {
            if (this.collectionName === GROUP_COLLECTION_NAME && !state.thrown) {
                state.thrown = true;
                return Promise.reject(new Error('simulated crash after roster write, before Group document commit'));
            }
            return realBulkWrite.call(this, operations, options);
        });
        return state;
    }

    describe('POST, PUT and $merge over GROUP_MEMBER_PROMOTION_LIMIT are rejected with too-costly', () => {
        test('POST: rejected, nothing is written', async () => {
            const createResp = await createGroup({ member: buildMembers(4, 'post-over-limit') });

            assertTooCostlyOperationOutcome(createResp, 4, 3);
            expect(await getMemberRowsByReferencePrefix('post-over-limit')).toHaveLength(0);
        });

        test('POST: not rejected when ENABLE_EXTENDED_GROUP is off -- member[] is stored inline', async () => {
            const savedEnableExtendedGroup = process.env.ENABLE_EXTENDED_GROUP;
            delete process.env.ENABLE_EXTENDED_GROUP;
            try {
                const createResp = await createGroup({ member: buildMembers(4, 'post-flag-off') });

                expect(createResp.status).toBe(201);
                const groupDoc = await getGroupDoc(createResp.body.id);
                expect(groupDoc[MONGO_GROUP_EXTENDED_FIELD]).not.toBe(true);
                expect(groupDoc.member).toHaveLength(4);
            } finally {
                process.env.ENABLE_EXTENDED_GROUP = savedEnableExtendedGroup;
            }
        });

        test('PUT-insert (new id): rejected, nothing is written', async () => {
            const groupId = 'put-insert-over-limit';

            const putResp = await putGroup(groupId, buildMembers(4, 'put-insert-over-limit'));

            assertTooCostlyOperationOutcome(putResp, 4, 3);
            expect(await getGroupDoc(groupId)).toBeNull();
            expect(await getMemberRowsByReferencePrefix('put-insert-over-limit')).toHaveLength(0);
        });

        test('PUT-update: rejected, the existing Group is unchanged and not promoted', async () => {
            const created = await createGroup({ member: buildMembers(2, 'put-update-over-limit') });
            expect(created.status).toBe(201);
            const groupId = created.body.id;

            const putResp = await putGroup(groupId, buildMembers(4, 'put-update-over-limit'));

            assertTooCostlyOperationOutcome(putResp, 4, 3);
            expect((await getGroupDoc(groupId)).meta.versionId).toBe('1');
            await expectNotPromoted(groupId, 2);
        });

        test('$merge-insert: the Group entry fails with too-costly and the Group is not written', async () => {
            const groupId = 'merge-insert-over-limit';

            const mergeResp = await mergeResources(groupBody(groupId, buildMembers(4, 'merge-insert-over-limit')));

            expect(mergeResp.status).toBe(200);
            expect(mergeResp.body).toEqual(expect.objectContaining({
                resourceType: 'Group', id: groupId, created: false, updated: false
            }));
            expect(mergeResp.body.issue.code).toBe('too-costly');
            expect(mergeResp.body.issue.diagnostics).toContain('4 > 3');
            expect(await getGroupDoc(groupId)).toBeNull();
            expect(await getMemberRowsByReferencePrefix('merge-insert-over-limit')).toHaveLength(0);
        });

        test('$merge-update: checked on the merged result -- 2 existing + 2 new members is rejected though the body only has 2', async () => {
            const created = await createGroup({ member: buildMembers(2, 'merge-update-existing') });
            expect(created.status).toBe(201);
            const groupId = created.body.id;

            const mergeResp = await mergeResources(groupBody(groupId, buildMembers(2, 'merge-update-new')));

            expect(mergeResp.status).toBe(200);
            expect(mergeResp.body).toEqual(expect.objectContaining({ id: groupId, created: false, updated: false }));
            expect(mergeResp.body.issue.code).toBe('too-costly');
            expect(mergeResp.body.issue.diagnostics).toContain('4 > 3');
            expect((await getGroupDoc(groupId)).meta.versionId).toBe('1');
            await expectNotPromoted(groupId, 2);
        });

        test('$merge list with other resource types: only the over-limit Group fails, the rest are written', async () => {
            const patientId = 'merge-mixed-patient';
            const overLimitGroupId = 'merge-mixed-group-over';
            const underLimitGroupId = 'merge-mixed-group-under';

            const mergeResp = await mergeResources([
                { resourceType: 'Patient', id: patientId, meta: defaultMeta('http://test-system.com/Patient') },
                groupBody(overLimitGroupId, buildMembers(4, 'merge-mixed-over')),
                groupBody(underLimitGroupId, buildMembers(2, 'merge-mixed-under'))
            ]);

            expect(mergeResp.status).toBe(200);
            expect(mergeResp.body).toHaveLength(3);
            const entryFor = (resourceType, id) => mergeResp.body.find(
                (entry) => entry.resourceType === resourceType && entry.id === id
            );

            expect(entryFor('Patient', patientId)).toEqual(expect.objectContaining({ created: true }));
            expect(entryFor('Group', underLimitGroupId)).toEqual(expect.objectContaining({ created: true }));
            const overLimitEntry = entryFor('Group', overLimitGroupId);
            expect(overLimitEntry).toEqual(expect.objectContaining({ created: false, updated: false }));
            expect(overLimitEntry.issue.code).toBe('too-costly');

            expect(await getGroupDoc(overLimitGroupId)).toBeNull();
            await expectNotPromoted(underLimitGroupId, 2);
        });
    });

    describe('PATCH promotes', () => {
        test('standard PATCH add ops on an embedded Group crossing the limit succeed and promote', async () => {
            const created = await createGroup({ member: buildMembers(2, 'patch-cross') });
            expect(created.status).toBe(201);

            const patchResp = await patchGroup(created.body.id, addMemberOps([
                'Patient/patch-cross-new-0',
                'Patient/patch-cross-new-1'
            ]));
            expect(patchResp.status).toBe(200);

            await expectPromoted(created.body.id, 4);
        });

        test('keeps the Group embedded until the PATCH goes over GROUP_MEMBER_PROMOTION_LIMIT', async () => {
            process.env.GROUP_MEMBER_PROMOTION_LIMIT = '5';
            const created = await createGroup({ member: buildMembers(3, 'patch-own-limit') });
            expect(created.status).toBe(201);
            const groupId = created.body.id;

            // 4 members: within the promotion limit (5).
            const firstPatch = await patchGroup(groupId, addMemberOps(['Patient/patch-own-limit-3']));
            expect(firstPatch.status).toBe(200);
            await expectNotPromoted(groupId, 4);

            // 6 members: over the promotion limit.
            const secondPatch = await patchGroup(groupId, addMemberOps([
                'Patient/patch-own-limit-4',
                'Patient/patch-own-limit-5'
            ]));
            expect(secondPatch.status).toBe(200);
            await expectPromoted(groupId, 6);
        });

        test('a further PATCH add on an already-promoted Group does not re-promote', async () => {
            const groupId = await createPromotedGroup('no-repromote');
            const firstVersionId = (await getGroupDoc(groupId)).meta.versionId;

            const patchResp = await patchGroup(groupId, addMemberOps(['Patient/no-repromote-extra']));
            expect(patchResp.status).toBe(200);

            const groupDoc = await getGroupDoc(groupId);
            expect(groupDoc[MONGO_GROUP_EXTENDED_FIELD]).toBe(true);
            expect(groupDoc.member).toBeUndefined();
            expect(parseInt(groupDoc.meta.versionId, 10)).toBeGreaterThan(parseInt(firstVersionId, 10));
            expect(await getMemberRows(groupDoc._uuid)).toHaveLength(5);
        });

        test('a member missing entity.reference rejects the whole PATCH instead of silently dropping the member', async () => {
            const created = await createGroup({ member: buildMembers(3, 'missing-ref') });
            expect(created.status).toBe(201);
            const groupId = created.body.id;

            const patchResp = await patchGroup(groupId, [
                { op: 'add', path: '/member/-', value: { entity: { display: 'no reference on this one' } } }
            ]);
            expect(patchResp.status).toBeGreaterThanOrEqual(400);

            // Validation runs before any roster write is attempted, so rejection is all-or-nothing
            // -- not a partial promotion that writes the other 3 and drops the bad entry.
            expect((await getGroupDoc(groupId)).meta.versionId).toBe('1');
            await expectNotPromoted(groupId, 3);
        });
    });

    describe('crash recovery', () => {
        test('a failure in the Group\'s own write leaves the roster written; the next PATCH completes promotion', async () => {
            const created = await createGroup({ member: buildMembers(2, 'crash-recovery') });
            expect(created.status).toBe(201);
            const groupId = created.body.id;
            const newMemberOps = addMemberOps(['Patient/crash-recovery-2', 'Patient/crash-recovery-3']);

            const state = failNextGroupWrite();
            try {
                const patchResp = await patchGroup(groupId, newMemberOps);
                expect(patchResp.status).toBeGreaterThanOrEqual(500);
                expect(state.thrown).toBe(true);

                // The Group document never committed, but the roster write already ran before it.
                await expectNotPromoted(groupId, 2, 4);
            } finally {
                Collection.prototype.bulkWrite.mockRestore();
            }

            // Retrying re-enters promotion. The 4 rows the abandoned attempt wrote are stamped with
            // the same target version, so they are kept and reused (nothing to rewrite), and this
            // time the Group's own commit succeeds.
            const retryResp = await patchGroup(groupId, newMemberOps);
            expect(retryResp.status).toBe(200);
            await expectPromoted(groupId, 4);
        });

        test('a retry for the same target version keeps the abandoned attempt\'s rows (partial writes are accepted)', async () => {
            const created = await createGroup({ member: buildMembers(2, 'same-target-base') });
            expect(created.status).toBe(201);
            const groupId = created.body.id;

            const state = failNextGroupWrite();
            try {
                const patchResp = await patchGroup(groupId, addMemberOps([
                    'Patient/same-target-first-0',
                    'Patient/same-target-first-1'
                ]));
                expect(patchResp.status).toBeGreaterThanOrEqual(500);
                expect(state.thrown).toBe(true);
                await expectNotPromoted(groupId, 2, 4);
            } finally {
                Collection.prototype.bulkWrite.mockRestore();
            }

            // Both attempts target the same next version number, so promotion only deletes rows
            // stamped below it: the abandoned attempt's rows stay and join the roster.
            const retryResp = await patchGroup(groupId, addMemberOps([
                'Patient/same-target-second-0',
                'Patient/same-target-second-1'
            ]));
            expect(retryResp.status).toBe(200);

            await expectPromoted(groupId, 6);
            const groupDoc = await getGroupDoc(groupId);
            const references = (await getMemberRows(groupDoc._uuid)).map((r) => r.member.entity.reference).sort();
            expect(references).toEqual([
                'Patient/same-target-base-0',
                'Patient/same-target-base-1',
                'Patient/same-target-first-0',
                'Patient/same-target-first-1',
                'Patient/same-target-second-0',
                'Patient/same-target-second-1'
            ]);
        });

        test('promotion deletes rows stamped with an earlier version', async () => {
            const created = await createGroup({ member: buildMembers(2, 'below-version-base') });
            expect(created.status).toBe(201);
            const groupId = created.body.id;
            const groupCollection = await getCollection(GROUP_COLLECTION_NAME);
            await groupCollection.updateOne({ id: groupId }, { $set: { 'meta.versionId': '8' } });

            // A failed promotion targeting version 9 leaves its roster stamped '9'.
            const state = failNextGroupWrite();
            try {
                const patchResp = await patchGroup(groupId, addMemberOps([
                    'Patient/below-version-abandoned-0',
                    'Patient/below-version-abandoned-1'
                ]));
                expect(patchResp.status).toBeGreaterThanOrEqual(500);
                expect(state.thrown).toBe(true);
            } finally {
                Collection.prototype.bulkWrite.mockRestore();
            }
            const groupUuid = (await getGroupDoc(groupId))._uuid;
            const abandonedRows = await getMemberRows(groupUuid);
            expect(abandonedRows).toHaveLength(4);
            expect(abandonedRows.every((r) => r.meta.versionId === '9')).toBe(true);

            // The Group then moves on to version 9 (some other write); the next promotion targets 10.
            await groupCollection.updateOne({ id: groupId }, { $set: { 'meta.versionId': '9' } });
            const retryResp = await patchGroup(groupId, addMemberOps([
                'Patient/below-version-second-0',
                'Patient/below-version-second-1'
            ]));
            expect(retryResp.status).toBe(200);

            await expectPromoted(groupId, 4);
            const rows = await getMemberRows(groupUuid);
            expect(rows.every((r) => r.meta.versionId === '10')).toBe(true);
            expect(rows.map((r) => r.member.entity.reference).sort()).toEqual([
                'Patient/below-version-base-0',
                'Patient/below-version-base-1',
                'Patient/below-version-second-0',
                'Patient/below-version-second-1'
            ]);
        });
    });

    describe('rows from an earlier life of the Group', () => {
        test('promotion deletes rows stamped with a later version than it claims (the Group\'s versions restarted)', async () => {
            const created = await createGroup({ member: buildMembers(2, 'restarted-base') });
            expect(created.status).toBe(201);
            const groupId = created.body.id;
            const groupCollection = await getCollection(GROUP_COLLECTION_NAME);
            await groupCollection.updateOne({ id: groupId }, { $set: { 'meta.versionId': '8' } });

            // A failed promotion leaves its roster stamped '9'.
            const state = failNextGroupWrite();
            try {
                const patchResp = await patchGroup(groupId, addMemberOps(['Patient/restarted-old-0', 'Patient/restarted-old-1']));
                expect(patchResp.status).toBeGreaterThanOrEqual(500);
                expect(state.thrown).toBe(true);
            } finally {
                Collection.prototype.bulkWrite.mockRestore();
            }
            const groupUuid = (await getGroupDoc(groupId))._uuid;
            expect((await getMemberRows(groupUuid)).every((r) => r.meta.versionId === '9')).toBe(true);

            // The Group is deleted and recreated, so its versions start over: the next promotion
            // claims version 2, below the leftover rows' stamp.
            await groupCollection.updateOne({ id: groupId }, { $set: { 'meta.versionId': '1' } });
            const retryResp = await patchGroup(groupId, addMemberOps(['Patient/restarted-new-0', 'Patient/restarted-new-1']));
            expect(retryResp.status).toBe(200);

            await expectPromoted(groupId, 4);
            const rows = await getMemberRows(groupUuid);
            expect(rows.every((r) => r.meta.versionId === '2')).toBe(true);
            expect(rows.map((r) => r.member.entity.reference).sort()).toEqual([
                'Patient/restarted-base-0',
                'Patient/restarted-base-1',
                'Patient/restarted-new-0',
                'Patient/restarted-new-1'
            ]);
        });
    });

    describe('roster write fails', () => {
        /**
         * Fails the GroupMember_4_0_0 bulk write with 10334 (document too large), which
         * mongoBulkWriteExecutor reports per entry instead of rethrowing. Only bulk writes whose
         * operations mention `referencePrefix` fail.
         */
        function failRosterWritesMatching (referencePrefix) {
            const realBulkWrite = Collection.prototype.bulkWrite;
            jest.spyOn(Collection.prototype, 'bulkWrite').mockImplementation(function (operations, options) {
                if (this.collectionName === GROUP_MEMBER_COLLECTION_NAME && JSON.stringify(operations).includes(referencePrefix)) {
                    return Promise.reject(Object.assign(new Error('simulated roster write failure'), { code: 10334 }));
                }
                return realBulkWrite.call(this, operations, options);
            });
        }

        test('PATCH promotion: the request fails and the Group is left unchanged instead of being saved with no members', async () => {
            const created = await createGroup({ member: buildMembers(2, 'promote-roster-fail') });
            expect(created.status).toBe(201);
            const groupId = created.body.id;

            failRosterWritesMatching('promote-roster-fail');
            try {
                const patchResp = await patchGroup(groupId, addMemberOps([
                    'Patient/promote-roster-fail-2',
                    'Patient/promote-roster-fail-3'
                ]));
                expect(patchResp.status).toBeGreaterThanOrEqual(500);
            } finally {
                Collection.prototype.bulkWrite.mockRestore();
            }

            expect((await getGroupDoc(groupId)).meta.versionId).toBe('1');
            await expectNotPromoted(groupId, 2);
        });

        test('PATCH on an already-extended Group: the request fails and the Group version is not bumped', async () => {
            const groupId = await createPromotedGroup('patch-roster-fail');
            const versionBefore = (await getGroupDoc(groupId)).meta.versionId;

            failRosterWritesMatching('patch-roster-fail-extra');
            try {
                const patchResp = await patchGroup(groupId, addMemberOps(['Patient/patch-roster-fail-extra']));
                expect(patchResp.status).toBeGreaterThanOrEqual(500);
            } finally {
                Collection.prototype.bulkWrite.mockRestore();
            }

            const groupDoc = await getGroupDoc(groupId);
            expect(groupDoc.meta.versionId).toBe(versionBefore);
            expect(await getMemberRows(groupDoc._uuid)).toHaveLength(4);
        });
    });

    describe('already-extended: rows from a failed member PATCH are not cleaned up by later writes', () => {
        test('a later metadata-only PATCH leaves the failed member add\'s row in place', async () => {
            const groupId = await createPromotedGroup('partial-write');
            const groupDocAfterPromotion = await getGroupDoc(groupId);
            const groupUuid = groupDocAfterPromotion._uuid;
            const versionAfterPromotion = parseInt(groupDocAfterPromotion.meta.versionId, 10);

            // Fail only the Group's own commit. The member rows are written before it, so the
            // failed request leaves a row stamped one version ahead of the Group.
            const state = failNextGroupWrite();
            try {
                const failedPatchResp = await patchGroup(groupId, addMemberOps(['Patient/partial-write-dangling']));
                expect(failedPatchResp.status).toBeGreaterThanOrEqual(500);
                expect(state.thrown).toBe(true);
            } finally {
                Collection.prototype.bulkWrite.mockRestore();
            }

            const groupDocAfterFailedPatch = await getGroupDoc(groupId);
            expect(parseInt(groupDocAfterFailedPatch.meta.versionId, 10)).toBe(versionAfterPromotion);
            expect(await getMemberRows(groupUuid)).toHaveLength(5);

            // Partial member writes are accepted: nothing but a promotion deletes rows, so a
            // metadata-only PATCH commits its own change and leaves the row alone.
            const metadataPatchResp = await patchGroup(groupId, [
                { op: 'add', path: '/active', value: true }
            ]);
            expect(metadataPatchResp.status).toBe(200);

            const groupDocAfterMetadataPatch = await getGroupDoc(groupId);
            expect(parseInt(groupDocAfterMetadataPatch.meta.versionId, 10)).toBe(versionAfterPromotion + 1);
            expect(groupDocAfterMetadataPatch[MONGO_GROUP_EXTENDED_FIELD]).toBe(true);

            const rowsAfterMetadataPatch = await getMemberRows(groupUuid);
            expect(rowsAfterMetadataPatch).toHaveLength(5);
            expect(rowsAfterMetadataPatch.some((r) => r.member.entity.reference === 'Patient/partial-write-dangling')).toBe(true);
        });
    });

    describe('ClickHouse-tracked Group', () => {
        // Safe to flip these env vars mid-file, inside a single test: isGroupOverLimit,
        // handleClickHouseGroupPreSave and GroupMemberEnrichmentProvider all read
        // configManager.enableClickHouse/mongoWithClickHouseResources fresh on every call.
        async function withClickHouseEnabledForGroup(fn) {
            const savedEnableClickHouse = process.env.ENABLE_CLICKHOUSE;
            const savedResources = process.env.MONGO_WITH_CLICKHOUSE_RESOURCES;
            process.env.ENABLE_CLICKHOUSE = '1';
            process.env.MONGO_WITH_CLICKHOUSE_RESOURCES = 'Group';
            try {
                await fn();
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
        }

        test('the useexternalstorage header on an already-extended Group neither tags it for ClickHouse nor changes its reads', async () => {
            const groupId = await createPromotedGroup('ch-header-extended');
            const headers = { ...getHeaders(), [USE_EXTERNAL_STORAGE_HEADER]: 'true' };
            const metadataOnlyBody = (name) => ({
                resourceType: 'Group', id: groupId, type: 'person', actual: true, name, meta: defaultMeta()
            });

            await withClickHouseEnabledForGroup(async () => {
                const putResp = await request
                    .put(`/4_0_0/Group/${groupId}`)
                    .send(metadataOnlyBody('renamed-by-put'))
                    .set(headers);
                expect(putResp.status).toBe(200);

                const mergeWithHeaderResp = await request
                    .post('/4_0_0/Group/$merge')
                    .send(metadataOnlyBody('renamed-by-merge-with-header'))
                    .set(headers);
                expect(mergeWithHeaderResp.status).toBe(200);
                expect(mergeWithHeaderResp.body.updated).toBe(true);

                const patchResp = await request
                    .patch(`/4_0_0/Group/${groupId}`)
                    .send(addMemberOps(['Patient/ch-header-extended-extra']))
                    .set({ ...getHeadersJsonPatch(), [USE_EXTERNAL_STORAGE_HEADER]: 'true' });
                expect(patchResp.status).toBe(200);

                const groupDoc = await getGroupDoc(groupId);
                expect(groupDoc[MONGO_GROUP_EXTENDED_FIELD]).toBe(true);
                expect(groupDoc.name).toBe('renamed-by-merge-with-header');
                expect(hasExternalStorageMemberTag(groupDoc)).toBe(false);
                expect(await getMemberRows(groupDoc._uuid)).toHaveLength(5);

                // Without the guard, GroupMemberEnrichmentProvider would overwrite quantity with
                // the ClickHouse count for this Group (0).
                const getResp = await request.get(`/4_0_0/Group/${groupId}`).set(headers);
                expect(getResp.status).toBe(200);
                expect(getResp.body.quantity).toBeUndefined();
                expect(getResp.body.member).toHaveLength(5);
            });
        });

        test('is skipped entirely -- no too-costly and no promotion; member[] is handled by ClickHouse', async () => {
            await withClickHouseEnabledForGroup(async () => {
                // isGroupOverLimit's ClickHouse exemption is a per-request fact, not a per-server
                // one (see its own docstring) -- server config alone isn't enough, this create
                // must also opt in via the useexternalstorage header, same as
                // GroupMemberPatchStrategy.determineGroupMemberType requires for routing writes.
                const created = await request
                    .post('/4_0_0/Group')
                    .send({
                        resourceType: 'Group',
                        type: 'person',
                        actual: true,
                        meta: defaultMeta(),
                        member: buildMembers(4, 'clickhouse-skip')
                    })
                    .set({ ...getHeaders(), [USE_EXTERNAL_STORAGE_HEADER]: 'true' });
                expect(created.status).toBe(201);

                const groupDoc = await getGroupDoc(created.body.id);
                expect(groupDoc[MONGO_GROUP_EXTENDED_FIELD]).not.toBe(true);
                expect(groupDoc.member).toBeUndefined();
                expect(await getMemberRows(groupDoc._uuid)).toHaveLength(0);
            });
        });
    });

    describe('versionId/lastUpdated parity across Group, GroupMember, and their history', () => {
        test('Group at version 4 with 4 inline members, promoted by a PATCH adding 50 more (54 total): every GroupMember row and both history collections land at version 5 with the Group\'s own lastUpdated', async () => {
            process.env.GROUP_MEMBER_PROMOTION_LIMIT = '50';

            // v1: create with 4 inline members -- well under the 50-member limit.
            const created = await createGroup({ member: buildMembers(4, 'parity') });
            expect(created.status).toBe(201);
            expect(created.body.meta.versionId).toBe('1');
            const groupId = created.body.id;

            // v2 -> v4: three metadata-only bumps that never touch /member.
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

            // GroupMember history: 54 fresh 'create' rows, every one at version 5 with the same
            // lastUpdated as the Group and its own history row above.
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
    });
});
