/**
 * Point-in-time GroupMember roster reconstruction on vread (DCON-5530)
 *
 * GET /4_0_0/Group/{id}/_history/{vid} on an extended Group streams the roster as it stood at
 * that historical version, reconstructed from GroupMember_4_0_0_History -- not the live
 * GroupMember_4_0_0 collection, which only reflects the current roster.
 */
const { describe, test, beforeEach, afterEach, expect } = require('@jest/globals');
const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    getHeadersJsonPatch,
    createTestRequest,
    getTestContainer,
    mockHttpContext
} = require('../common');
const { MONGO_GROUP_EXTENDED_FIELD } = require('../../../utils/mongoGroupExtendedTag');
const {
    MONGO_GROUP_MEMBER_TAG_SYSTEM,
    MONGO_GROUP_MEMBER_TAG_CODE
} = require('../../../enrich/providers/groupExtendedTagEnrichmentProvider');

const GROUP_COLLECTION_NAME = 'Group_4_0_0';

describe('Group vread roster reconstruction (extended storage)', () => {
    let requestId;

    let originalEnableExtendedGroup;

    beforeEach(async () => {
        originalEnableExtendedGroup = process.env.ENABLE_EXTENDED_GROUP;
        process.env.ENABLE_EXTENDED_GROUP = '1';
        await commonBeforeEach();
        requestId = mockHttpContext();
    });

    afterEach(async () => {
        await commonAfterEach();
        process.env.ENABLE_EXTENDED_GROUP = originalEnableExtendedGroup;
    });

    function defaultMeta () {
        return {
            source: 'http://test-system.com/Group',
            security: [
                { system: 'https://www.icanbwell.com/owner', code: 'test-owner' },
                { system: 'https://www.icanbwell.com/access', code: 'test-access' }
            ]
        };
    }

    async function createExtendedGroup (request) {
        const createResp = await request
            .post('/4_0_0/Group')
            .send({
                resourceType: 'Group',
                meta: defaultMeta(),
                type: 'person',
                actual: true
            })
            .set(getHeaders());
        expect(createResp).toHaveStatusCode(201);
        const groupId = createResp.body.id;

        const container = getTestContainer();
        const fhirDb = await container.mongoDatabaseManager.getClientDbAsync();
        const groupCollection = fhirDb.collection(GROUP_COLLECTION_NAME);
        await groupCollection.updateOne(
            { id: groupId },
            { $set: { [MONGO_GROUP_EXTENDED_FIELD]: true } }
        );
        return groupId;
    }

    async function patchGroup (request, groupId, patchOps) {
        const resp = await request
            .patch(`/4_0_0/Group/${groupId}`)
            .send(patchOps)
            .set(getHeadersJsonPatch());
        // History writes (both the Group's own and GroupMember's) are deferred to a
        // post-request task -- wait for them before reading history back.
        await getTestContainer().postRequestProcessor.waitTillDoneAsync({ requestId });
        return resp;
    }

    function membersOf (body) {
        return (body.member || []).map((m) => m.entity.reference);
    }

    test('reflects a member present only between its add and remove versions, and again ' +
        'after being re-added -- even though the re-added row restarts at versionId 1', async () => {
        const request = await createTestRequest();
        const groupId = await createExtendedGroup(request);
        const patientRef = 'Patient/vread-roster-1';

        const addResp = await patchGroup(request, groupId, [
            { op: 'add', path: '/member/-', value: { entity: { reference: patientRef } } }
        ]);
        expect(addResp.status).toBe(200);
        const addedVersion = addResp.body.meta.versionId;

        const removeResp = await patchGroup(request, groupId, [
            { op: 'remove', path: '/member/-', value: { entity: { reference: patientRef } } }
        ]);
        expect(removeResp.status).toBe(200);
        const removedVersion = removeResp.body.meta.versionId;

        const readdResp = await patchGroup(request, groupId, [
            { op: 'add', path: '/member/-', value: { entity: { reference: patientRef } } }
        ]);
        expect(readdResp.status).toBe(200);
        const readdedVersion = readdResp.body.meta.versionId;

        const beforeAddResp = await request
            .get(`/4_0_0/Group/${groupId}/_history/1`)
            .set(getHeaders());
        expect(beforeAddResp.status).toBe(200);
        expect(membersOf(JSON.parse(beforeAddResp.text))).not.toContain(patientRef);

        const atAddResp = await request
            .get(`/4_0_0/Group/${groupId}/_history/${addedVersion}`)
            .set(getHeaders());
        expect(atAddResp.status).toBe(200);
        expect(membersOf(JSON.parse(atAddResp.text))).toContain(patientRef);

        const atRemoveResp = await request
            .get(`/4_0_0/Group/${groupId}/_history/${removedVersion}`)
            .set(getHeaders());
        expect(atRemoveResp.status).toBe(200);
        expect(membersOf(JSON.parse(atRemoveResp.text))).not.toContain(patientRef);

        const atReaddResp = await request
            .get(`/4_0_0/Group/${groupId}/_history/${readdedVersion}`)
            .set(getHeaders());
        expect(atReaddResp.status).toBe(200);
        expect(membersOf(JSON.parse(atReaddResp.text))).toContain(patientRef);
    });

    test('GET on an extended Group\'s historical version returns the resource as-is, without ' +
        'streaming the roster, when ENABLE_EXTENDED_GROUP is disabled', async () => {
        const request = await createTestRequest();
        const groupId = await createExtendedGroup(request);
        const container = getTestContainer();
        const originalValue = container.configManager.enableExtendedGroup;

        const addResp = await patchGroup(request, groupId, [
            { op: 'add', path: '/member/-', value: { entity: { reference: 'Patient/vread-roster-2' } } }
        ]);
        const addedVersion = addResp.body.meta.versionId;

        Object.defineProperty(container.configManager, 'enableExtendedGroup', {
            get: () => false,
            configurable: true
        });
        try {
            const resp = await request
                .get(`/4_0_0/Group/${groupId}/_history/${addedVersion}`)
                .set(getHeaders());

            expect(resp.status).toBe(200);
            const body = JSON.parse(resp.text);
            expect(body.member || []).toEqual([]);
        } finally {
            Object.defineProperty(container.configManager, 'enableExtendedGroup', {
                get: () => originalValue,
                configurable: true
            });
        }
    });
});

describe('Group history list on a Group promoted to extended storage mid-history', () => {
    let requestId;
    let originalEnableExtendedGroup;
    let originalPromotionLimit;

    beforeEach(async () => {
        originalEnableExtendedGroup = process.env.ENABLE_EXTENDED_GROUP;
        originalPromotionLimit = process.env.GROUP_MEMBER_PROMOTION_LIMIT;
        process.env.ENABLE_EXTENDED_GROUP = '1';
        process.env.GROUP_MEMBER_PROMOTION_LIMIT = '2';
        await commonBeforeEach();
        requestId = mockHttpContext();
    });

    afterEach(async () => {
        await commonAfterEach();
        process.env.ENABLE_EXTENDED_GROUP = originalEnableExtendedGroup;
        if (originalPromotionLimit === undefined) {
            delete process.env.GROUP_MEMBER_PROMOTION_LIMIT;
        } else {
            process.env.GROUP_MEMBER_PROMOTION_LIMIT = originalPromotionLimit;
        }
    });

    async function waitForPostRequestTasks () {
        await getTestContainer().postRequestProcessor.waitTillDoneAsync({ requestId });
    }

    async function addMembers (request, groupId, references) {
        const resp = await request
            .patch(`/4_0_0/Group/${groupId}`)
            .send(references.map((reference) => ({
                op: 'add', path: '/member/-', value: { entity: { reference } }
            })))
            .set(getHeadersJsonPatch());
        await waitForPostRequestTasks();
        expect(resp.status).toBe(200);
        return resp;
    }

    /**
     * waitTillDoneAsync can return while the last write's history task is still running, so poll
     * until the expected number of versions is visible.
     * @return {Promise<Object<string, Object>>} history resources keyed by versionId
     */
    async function readHistoryVersionsAsync (request, url, expectedCount, timeoutMs = 5000) {
        const deadline = Date.now() + timeoutMs;
        let versions = {};
        while (Date.now() < deadline) {
            const resp = await request.get(url).set(getHeaders());
            expect(resp.status).toBe(200);
            versions = Object.fromEntries(
                (JSON.parse(resp.text).entry || []).map((e) => [e.resource.meta.versionId, e.resource])
            );
            if (Object.keys(versions).length >= expectedCount) {
                break;
            }
            await new Promise((resolve) => setTimeout(resolve, 100));
        }
        return versions;
    }

    function hasExtendedTag (resource) {
        return (resource.meta.tag || []).some(
            (t) => t.system === MONGO_GROUP_MEMBER_TAG_SYSTEM && t.code === MONGO_GROUP_MEMBER_TAG_CODE
        );
    }

    test.each([
        ['instance history', (groupId) => `/4_0_0/Group/${groupId}/_history`],
        ['type history', () => '/4_0_0/Group/_history']
    ])('%s tags extended versions and leaves embedded versions untagged', async (_label, historyUrl) => {
        const request = await createTestRequest();
        const createResp = await request
            .post('/4_0_0/Group')
            .send({
                resourceType: 'Group',
                meta: {
                    source: 'http://test-system.com/Group',
                    security: [
                        { system: 'https://www.icanbwell.com/owner', code: 'test-owner' },
                        { system: 'https://www.icanbwell.com/access', code: 'test-access' }
                    ]
                },
                type: 'person',
                actual: true,
                member: [{ entity: { reference: 'Patient/history-tag-1' } }]
            })
            .set(getHeaders());
        await waitForPostRequestTasks();
        expect(createResp).toHaveStatusCode(201);
        const groupId = createResp.body.id;

        // v2: still within the promotion limit, so still embedded
        await addMembers(request, groupId, ['Patient/history-tag-2']);
        // v3: crosses the limit, so this PATCH promotes the Group
        const promoteResp = await addMembers(request, groupId, ['Patient/history-tag-3']);
        expect(hasExtendedTag(promoteResp.body)).toBe(true);
        // v4: a write on the already-extended Group
        await addMembers(request, groupId, ['Patient/history-tag-4']);

        const versions = await readHistoryVersionsAsync(request, historyUrl(groupId), 4);

        expect(Object.keys(versions).sort()).toEqual(['1', '2', '3', '4']);
        for (const versionId of ['1', '2']) {
            expect(versions[versionId].member).toHaveLength(Number(versionId));
            expect(hasExtendedTag(versions[versionId])).toBe(false);
        }
        for (const versionId of ['3', '4']) {
            expect(versions[versionId].member).toBeUndefined();
            expect(hasExtendedTag(versions[versionId])).toBe(true);
        }
    });
});
