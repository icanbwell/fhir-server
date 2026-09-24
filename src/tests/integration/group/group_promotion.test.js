/**
 * Group promotion to extended member storage (DCON-5528)
 *
 * Once an *existing* Group's member[] crosses configManager.groupMemberLimit,
 * promoteExistingGroupIfNeeded (src/utils/groupPromotion.js) promotes it: called directly from the
 * write paths that can promote an existing Group -- update.js's PUT-existing branch, patch.js (the
 * embedded-regime branch), and mergeManager.js (both branches) -- right before each one's own
 * replaceOneAsync/mergeOneAsync call. Promotion first bulk-writes the roster into GroupMember_4_0_0
 * (via the same MongoGroupMemberRepository the PATCH write path already uses -- see
 * group_member_patch_write.test.js), then -- only once that succeeds -- mutates the in-memory doc
 * (unsets member[], sets MONGO_GROUP_EXTENDED_FIELD/_extended: true) that the caller is about to
 * persist, so the strip+flag rides along in the SAME physical write and the SAME meta.versionId
 * bump the caller already intended, rather than a second, separately-versioned write.
 *
 * A brand-new Group (CREATE, PUT-insert) is rejected outright instead of promoted when member[]
 * already arrives over the limit (rejectNewGroupIfOverLimit): a fresh POST always mints a
 * server-generated id, so a promote-then-fail on that path could orphan roster rows with nothing
 * left to recover through. $merge-insert is the one brand-new-Group path that still promotes: the
 * client (not the server) supplies id there, so
 * identity is stable across a retry -- if the Group's own write then fails, the roster rows
 * already staged are simply left as they are (see "Group's own write fails after promotion
 * already staged the roster" below), and the next write to the same uuid resolves them
 * idempotently, same as any other crash-recovery case. This reject is narrower than the original
 * epic doc's Task B1, which rejected any single bulk write over the limit (including PUT-update
 * and $merge) and promoted only a dedicated incremental-add operation that no longer exists in
 * this codebase -- scoped down deliberately to just the orphan-risk case.
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
        test('member[] already over the limit is rejected outright, nothing is written', async () => {
            process.env.MAX_GROUP_MEMBERS_PER_PUT = '3';
            const members = buildMembers(4, 'create-over-limit');

            const createResp = await createGroup({ member: members });
            expect(createResp.status).toBe(400);

            const rows = await getMemberRowsByReferencePrefix('create-over-limit');
            expect(rows).toHaveLength(0);
        });

        test('via PUT-insert (new id), member[] already over the limit is rejected outright, nothing is written', async () => {
            process.env.MAX_GROUP_MEMBERS_PER_PUT = '3';
            const groupId = 'put-insert-over-limit';
            const members = buildMembers(4, 'put-insert-over-limit');

            const putResp = await request
                .put(`/4_0_0/Group/${groupId}`)
                .send({
                    resourceType: 'Group',
                    id: groupId,
                    type: 'person',
                    actual: true,
                    meta: defaultMeta(),
                    member: members
                })
                .set(getHeaders());
            expect(putResp.status).toBe(400);

            const groupDoc = await getGroupDoc(groupId);
            expect(groupDoc).toBeNull();

            const rows = await getMemberRowsByReferencePrefix('put-insert-over-limit');
            expect(rows).toHaveLength(0);
        });

        test('via $merge (insert), member[] already over the limit still succeeds and promotes -- client-supplied id keeps identity stable across a retry, unlike plain CREATE/PUT-insert', async () => {
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
            // Created under the limit, then crossed via PUT-update -- CREATE itself now rejects an
            // over-limit brand-new Group outright (see the "CREATE" describe block above), so
            // getting to an already-promoted Group has to go through an existing-Group crossing.
            const created = await createGroup({ member: buildMembers(3, 'no-repromote') });
            expect(created.status).toBe(201);

            const putResp = await request
                .put(`/4_0_0/Group/${created.body.id}`)
                .send({
                    resourceType: 'Group',
                    id: created.body.id,
                    type: 'person',
                    actual: true,
                    meta: defaultMeta(),
                    member: buildMembers(4, 'no-repromote')
                })
                .set(getHeaders());
            expect(putResp.status).toBe(200);
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

                // Retrying the same PUT re-enters promoteExistingGroupIfNeeded; promoteGroup wipes
                // the 4 rows the abandoned attempt already wrote (this Group was never
                // successfully extended, so none of them were ever legitimate) and writes 4 fresh
                // ones from the same content, and this time the Group document's own commit
                // succeeds, completing promotion.
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

    describe('member missing entity.reference', () => {
        test('promotion rejects the whole write instead of silently dropping the member', async () => {
            process.env.MAX_GROUP_MEMBERS_PER_PUT = '3';
            const groupId = 'missing-ref-merge';
            const members = [
                ...buildMembers(3, 'missing-ref'),
                { entity: { display: 'no reference on this one' } }
            ];

            // Routed through $merge (insert) rather than plain CREATE: CREATE now rejects an
            // over-limit brand-new Group outright before promoteGroup's own validation ever runs
            // (see the "CREATE" describe block above), so $merge-insert -- which still promotes --
            // is what exercises promoteGroup's entity.reference guard here.
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
            const groupEntry = Array.isArray(mergeResp.body) ? mergeResp.body[0] : mergeResp.body;
            expect(groupEntry.created).toBeFalsy();
            expect(groupEntry.updated).toBeFalsy();

            // Validation runs before any roster write is attempted, so rejection is all-or-nothing
            // -- not a partial promotion that silently drops just the bad entry while writing the
            // other 3 (which is what used to happen: the doc.member delete erased all 4 forever,
            // but only 3 had ever actually been written to GroupMember_4_0_0).
            const rows = await getMemberRowsByReferencePrefix('missing-ref');
            expect(rows).toHaveLength(0);
        });
    });

    describe('Group\'s own write fails after promotion already staged the roster', () => {
        test('$merge update: roster rows are left as staged (not rolled back), and a retry completes promotion idempotently', async () => {
            process.env.MAX_GROUP_MEMBERS_PER_PUT = '3';
            const created = await createGroup({ member: buildMembers(2, 'merge-rollback') });
            expect(created.status).toBe(201);
            const groupId = created.body.id;
            const groupUuid = (await getGroupDoc(groupId))._uuid;

            const container = getTestContainer();
            const realMergeOneAsync = container.fastDatabaseBulkInserter.mergeOneAsync.bind(container.fastDatabaseBulkInserter);
            const spy = jest.spyOn(container.fastDatabaseBulkInserter, 'mergeOneAsync')
                .mockImplementation(async (params) => {
                    // Only the Group's own staging call fails -- promoteExistingGroupIfNeeded's
                    // roster writes (flush: false) have already joined the same batch buffer by
                    // the time mergeManager reaches this call.
                    if (params.resourceType === 'Group') {
                        throw new Error('simulated failure staging the Group\'s own write, after roster promotion already ran');
                    }
                    return realMergeOneAsync(params);
                });

            const allMembers = [...buildMembers(2, 'merge-rollback'), ...buildMembers(2, 'merge-rollback-new')];
            const mergeRequestBody = {
                resourceType: 'Group',
                id: groupId,
                type: 'person',
                actual: true,
                meta: defaultMeta(),
                member: allMembers
            };

            try {
                const mergeResp = await request
                    .post('/4_0_0/Group/$merge')
                    .send(mergeRequestBody)
                    .set(getHeaders());

                // The batch call itself still responds 200 -- $merge reports per-resource outcomes
                // in the body rather than failing the whole HTTP call.
                expect(mergeResp.status).toBe(200);
                const groupEntry = Array.isArray(mergeResp.body) ? mergeResp.body[0] : mergeResp.body;
                expect(groupEntry.created).toBeFalsy();
                expect(groupEntry.updated).toBeFalsy();

                // The Group document itself never changed: still 2 embedded members, never
                // promoted -- its own write never made it past staging.
                const groupDocAfter = await getGroupDoc(groupId);
                expect(groupDocAfter[MONGO_GROUP_EXTENDED_FIELD]).not.toBe(true);
                expect(groupDocAfter.member).toHaveLength(2);

                // promoteExistingGroupIfNeeded already staged 4 GroupMember create ops (flush:
                // false) before the Group's own mergeOneAsync failed. There is no rollback for
                // this: the Group's own meta.versionId was never bumped (that write is exactly the
                // one that threw), so those rows surviving the batch's end-of-loop executeAsync()
                // flush is harmless -- the Group looks exactly like the crash-recovery case, and a
                // retry resolves them as no-ops rather than duplicating.
                const rows = await getMemberRows(groupUuid);
                expect(rows).toHaveLength(4);
            } finally {
                spy.mockRestore();
            }

            // The critical assertion: retrying the identical request (mergeOneAsync no longer
            // mocked) completes promotion, and the 4 rows already written above are resolved as
            // no-ops rather than duplicated.
            const retryResp = await request
                .post('/4_0_0/Group/$merge')
                .send(mergeRequestBody)
                .set(getHeaders());
            expect(retryResp.status).toBe(200);
            const retryEntry = Array.isArray(retryResp.body) ? retryResp.body[0] : retryResp.body;
            expect(retryEntry.updated).toBe(true);

            await expectPromoted(groupId, 4);
        });

        // CREATE (and update.js's create-via-PUT branch) intentionally has NO equivalent test here.
        // Both reject an over-limit brand-new Group outright instead of promoting it (see the
        // "CREATE" describe block above) -- nothing is ever staged for either write, so there is no
        // roster-vs-Group scenario to exercise for that path.
    });

    describe('not-yet-extended: promotion wipes stale rows before retrying', () => {
        test('a retry with a different member set than the one that crashed does not resurrect the abandoned attempt\'s rows', async () => {
            process.env.MAX_GROUP_MEMBERS_PER_PUT = '3';

            const created = await createGroup({ member: buildMembers(2, 'wipe-retry-base') });
            expect(created.status).toBe(201);
            const groupId = created.body.id;

            const realBulkWrite = Collection.prototype.bulkWrite;
            let thrown = false;
            jest.spyOn(Collection.prototype, 'bulkWrite').mockImplementation(function (operations, options) {
                if (this.collectionName === GROUP_COLLECTION_NAME && !thrown) {
                    thrown = true;
                    return Promise.reject(new Error('simulated crash after roster write, before Group document commit'));
                }
                return realBulkWrite.call(this, operations, options);
            });

            try {
                const firstAttemptMembers = [
                    ...buildMembers(2, 'wipe-retry-base'),
                    ...buildMembers(2, 'wipe-retry-first-attempt')
                ];
                const putResp = await request
                    .put(`/4_0_0/Group/${groupId}`)
                    .send({
                        resourceType: 'Group',
                        id: groupId,
                        type: 'person',
                        actual: true,
                        meta: defaultMeta(),
                        member: firstAttemptMembers
                    })
                    .set(getHeaders());
                expect(putResp.status).toBeGreaterThanOrEqual(500);
                expect(thrown).toBe(true);

                const groupDocAfterCrash = await getGroupDoc(groupId);
                expect(groupDocAfterCrash[MONGO_GROUP_EXTENDED_FIELD]).not.toBe(true);
                expect(groupDocAfterCrash.member).toHaveLength(2);
                const rowsAfterCrash = await getMemberRows(groupDocAfterCrash._uuid);
                expect(rowsAfterCrash).toHaveLength(4);
            } finally {
                Collection.prototype.bulkWrite.mockRestore();
            }

            // Retry with a DIFFERENT pair of new members -- not a resend of the same request.
            // Both attempts target the same next version number (the Group never advanced past
            // its pre-crash version), so without promoteGroup's wipe, the abandoned attempt's rows
            // (wipe-retry-first-attempt-*) would still be sitting at that same number and could be
            // mistaken for real members once this retry's Group commit lands there for real.
            const secondAttemptMembers = [
                ...buildMembers(2, 'wipe-retry-base'),
                ...buildMembers(2, 'wipe-retry-second-attempt')
            ];
            const retryResp = await request
                .put(`/4_0_0/Group/${groupId}`)
                .send({
                    resourceType: 'Group',
                    id: groupId,
                    type: 'person',
                    actual: true,
                    meta: defaultMeta(),
                    member: secondAttemptMembers
                })
                .set(getHeaders());
            expect(retryResp.status).toBe(200);

            await expectPromoted(groupId, 4);
            const groupDoc = await getGroupDoc(groupId);
            const rows = await getMemberRows(groupDoc._uuid);
            const references = rows.map((r) => r.member.entity.reference).sort();
            expect(references).toEqual([
                'Patient/wipe-retry-base-0',
                'Patient/wipe-retry-base-1',
                'Patient/wipe-retry-second-attempt-0',
                'Patient/wipe-retry-second-attempt-1'
            ]);
        });
    });

    describe('already-extended: a failed member PATCH leaves a forward-dangling orphan, cleaned up by the next write', () => {
        test('a later metadata-only PATCH removes the dangling row from the failed member add before committing its own change', async () => {
            process.env.MAX_GROUP_MEMBERS_PER_PUT = '3';

            const created = await createGroup({ member: buildMembers(3, 'orphan-cleanup') });
            expect(created.status).toBe(201);
            const groupId = created.body.id;

            const putResp = await request
                .put(`/4_0_0/Group/${groupId}`)
                .send({
                    resourceType: 'Group',
                    id: groupId,
                    type: 'person',
                    actual: true,
                    meta: defaultMeta(),
                    member: buildMembers(4, 'orphan-cleanup')
                })
                .set(getHeaders());
            expect(putResp.status).toBe(200);
            await expectPromoted(groupId, 4);
            const groupDocAfterPromotion = await getGroupDoc(groupId);
            const groupUuid = groupDocAfterPromotion._uuid;
            const versionAfterPromotion = parseInt(groupDocAfterPromotion.meta.versionId, 10);

            // Fail only the Group's own commit. commitPendingMemberWrites (the roster's own
            // write) now runs BEFORE it -- see patch.js's reordering -- so this simulates exactly
            // the case that reorder was meant to convert: a forward-dangling orphan instead of a
            // silently-stale row nothing could ever detect.
            const realBulkWrite = Collection.prototype.bulkWrite;
            let thrown = false;
            jest.spyOn(Collection.prototype, 'bulkWrite').mockImplementation(function (operations, options) {
                if (this.collectionName === GROUP_COLLECTION_NAME && !thrown) {
                    thrown = true;
                    return Promise.reject(new Error('simulated crash after roster write, before Group document commit'));
                }
                return realBulkWrite.call(this, operations, options);
            });

            try {
                const failedPatchResp = await patchGroup(groupId, [
                    { op: 'add', path: '/member/-', value: { entity: { reference: 'Patient/orphan-cleanup-dangling' } } }
                ]);
                expect(failedPatchResp.status).toBeGreaterThanOrEqual(500);
                expect(thrown).toBe(true);
            } finally {
                Collection.prototype.bulkWrite.mockRestore();
            }

            // The Group's own commit never landed -- still at its pre-patch version -- but the
            // roster write that ran before it did, leaving a row stamped one version ahead of what
            // the Group actually shows.
            const groupDocAfterFailedPatch = await getGroupDoc(groupId);
            expect(parseInt(groupDocAfterFailedPatch.meta.versionId, 10)).toBe(versionAfterPromotion);
            const rowsAfterFailedPatch = await getMemberRows(groupUuid);
            expect(rowsAfterFailedPatch).toHaveLength(5);
            const danglingRow = rowsAfterFailedPatch.find(
                (r) => r.member.entity.reference === 'Patient/orphan-cleanup-dangling'
            );
            expect(danglingRow).toBeDefined();
            expect(parseInt(danglingRow.meta.versionId, 10)).toBe(versionAfterPromotion + 1);

            // A completely unrelated, metadata-only PATCH -- no member ops at all -- still removes
            // the dangling row before committing its own change, via cleanupExtendedGroupOrphansIfNeeded.
            const metadataPatchResp = await patchGroup(groupId, [
                { op: 'add', path: '/active', value: true }
            ]);
            expect(metadataPatchResp.status).toBe(200);

            const groupDocAfterMetadataPatch = await getGroupDoc(groupId);
            expect(parseInt(groupDocAfterMetadataPatch.meta.versionId, 10)).toBe(versionAfterPromotion + 1);
            expect(groupDocAfterMetadataPatch[MONGO_GROUP_EXTENDED_FIELD]).toBe(true);
            expect(groupDocAfterMetadataPatch.member).toBeUndefined();

            const rowsAfterCleanup = await getMemberRows(groupUuid);
            expect(rowsAfterCleanup).toHaveLength(4);
            expect(rowsAfterCleanup.some((r) => r.member.entity.reference === 'Patient/orphan-cleanup-dangling')).toBe(false);
        });
    });

    describe('ClickHouse-tracked Group', () => {
        // Safe to flip these env vars mid-file, inside a single test: isGroupOverLimit (called by
        // both rejectNewGroupIfOverLimit/promoteExistingGroupIfNeeded) reads
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
