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

const GROUP_COLLECTION_NAME = 'Group_4_0_0';

describe('Group vread roster reconstruction (extended storage)', () => {
    let requestId;

    beforeEach(async () => {
        await commonBeforeEach();
        requestId = mockHttpContext();
    });

    afterEach(async () => {
        await commonAfterEach();
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
