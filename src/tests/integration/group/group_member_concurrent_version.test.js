/**
 * Concurrent member PATCH on an extended Group: Group version integrity.
 *
 * `databaseBulkInserter.replaceOneAsync` builds the Group's replace filter as `{ _uuid: uuid }`
 * with no version predicate, so a `replaceOne` matches whatever version is currently stored.
 * `mongoBulkWriteExecutor`'s concurrency fallback only fires when
 * `bulkWriteResult.modifiedCount < expectedUpdatesCount`, which cannot happen when the filter
 * always matches. So optimistic concurrency is structurally unable to detect a conflict on this
 * path even though `configManager.handleConcurrency` defaults to on.
 *
 * Two properties have to hold for the derived-lifecycle reconstruction that the extended regime
 * depends on, because it orders a member's history by the owning Group's versionId:
 *
 *   1. No membership write is lost.
 *   2. Two distinct commits never share a Group versionId. If they do, `(memberUuid,
 *      groupVersionId)` stops being a unique ordering key and point-in-time reconstruction at
 *      that version is ambiguous.
 *
 * This drives concurrent PATCHes through the real HTTP path and asserts both.
 */
const { describe, test, beforeAll, beforeEach, afterAll, expect } = require('@jest/globals');
const {
    setupGroupTests,
    teardownGroupTests,
    cleanupAllData,
    getSharedRequest,
    getTestHeaders
} = require('./groupTestSetup');
const { getTestContainer, getHeadersJsonPatch } = require('../common');
const { GROUP_MEMBER_COLLECTION_NAME } = require('../../../constants');
const { MONGO_GROUP_EXTENDED_FIELD } = require('../../../utils/mongoGroupExtendedTag');

const GROUP_COLLECTION_NAME = 'Group_4_0_0';
const GROUP_HISTORY_COLLECTION_NAME = 'Group_4_0_0_History';
const CONCURRENT_WRITES = 4;

describe('Concurrent member PATCH on an extended Group', () => {
    let groupId;
    let groupUuid;

    beforeAll(async () => {
        await setupGroupTests();
    }, 60000);

    afterAll(async () => {
        await teardownGroupTests();
    });

    async function getDb() {
        const container = getTestContainer();
        return container.mongoDatabaseManager.getClientDbAsync();
    }

    beforeEach(async () => {
        await cleanupAllData();
        const db = await getDb();
        await db.collection(GROUP_MEMBER_COLLECTION_NAME).deleteMany({});
        await db.collection(GROUP_HISTORY_COLLECTION_NAME).deleteMany({});

        const createResponse = await getSharedRequest()
            .post('/4_0_0/Group')
            .send({
                resourceType: 'Group',
                type: 'person',
                actual: true,
                name: 'Concurrency Probe Group',
                meta: {
                    source: 'http://test-system.com/Group',
                    security: [
                        { system: 'https://www.icanbwell.com/owner', code: 'test-owner' },
                        { system: 'https://www.icanbwell.com/access', code: 'test-access' }
                    ]
                }
            })
            .set(getTestHeaders());
        expect(createResponse.status).toBe(201);
        groupId = createResponse.body.id;

        await db
            .collection(GROUP_COLLECTION_NAME)
            .updateOne({ id: groupId }, { $set: { [MONGO_GROUP_EXTENDED_FIELD]: true } });
        const groupDoc = await db.collection(GROUP_COLLECTION_NAME).findOne({ id: groupId });
        groupUuid = groupDoc._uuid;
        expect(groupUuid).toBeTruthy();
    }, 60000);

    function addMemberPatch(reference) {
        return getSharedRequest()
            .patch(`/4_0_0/Group/${groupId}`)
            .send([{ op: 'add', path: '/member/-', value: { entity: { reference } } }])
            .set(getHeadersJsonPatch());
    }

    test(`${CONCURRENT_WRITES} concurrent member adds keep every member and never reuse a Group version`, async () => {
        const references = Array.from(
            { length: CONCURRENT_WRITES },
            (_unused, i) => `Patient/concurrent-${i}`
        );

        const responses = await Promise.all(references.map((reference) => addMemberPatch(reference)));
        const succeeded = responses.filter((r) => r.status === 200);

        // A rejected write is an acceptable outcome for a concurrency conflict. A silently
        // accepted write that loses data is not. Only assert against what actually succeeded.
        const db = await getDb();
        const memberRows = await db
            .collection(GROUP_MEMBER_COLLECTION_NAME)
            .find({ groupUuid })
            .toArray();

        expect(memberRows).toHaveLength(succeeded.length);

        const historyRows = await db
            .collection(GROUP_HISTORY_COLLECTION_NAME)
            .find({ 'resource._uuid': groupUuid })
            .toArray();
        const historyVersions = historyRows.map((r) => String(r.resource?.meta?.versionId));
        const distinctHistoryVersions = [...new Set(historyVersions)];

        // Each accepted PATCH is its own commit and must occupy its own Group version.
        expect(distinctHistoryVersions).toHaveLength(historyVersions.length);

        // The composite ordering key the derived-lifecycle reconstruction relies on.
        const memberVersionPairs = memberRows.map(
            (r) => `${r._uuid}|${String(r.meta?.versionId)}`
        );
        expect([...new Set(memberVersionPairs)]).toHaveLength(memberRows.length);

        const memberVersions = memberRows.map((r) => String(r.meta?.versionId));
        expect([...new Set(memberVersions)]).toHaveLength(memberRows.length);
    }, 120000);

    test('sequential member adds each occupy their own Group version (control)', async () => {
        for (let i = 0; i < CONCURRENT_WRITES; i++) {
            const response = await addMemberPatch(`Patient/sequential-${i}`);
            expect(response.status).toBe(200);
        }

        const db = await getDb();
        const historyRows = await db
            .collection(GROUP_HISTORY_COLLECTION_NAME)
            .find({ 'resource._uuid': groupUuid })
            .toArray();
        const versions = historyRows.map((r) => String(r.resource?.meta?.versionId));

        expect([...new Set(versions)]).toHaveLength(versions.length);

        const memberRows = await db
            .collection(GROUP_MEMBER_COLLECTION_NAME)
            .find({ groupUuid })
            .toArray();
        expect(memberRows).toHaveLength(CONCURRENT_WRITES);
        const memberVersions = memberRows.map((r) => String(r.meta?.versionId));
        expect([...new Set(memberVersions)]).toHaveLength(CONCURRENT_WRITES);
    }, 120000);
});
