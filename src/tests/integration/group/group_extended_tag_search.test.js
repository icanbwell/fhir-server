const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');
const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    createTestRequest,
    getTestContainer
} = require('../common');
const {
    MONGO_GROUP_EXTENDED_FIELD,
    MONGO_GROUP_MEMBER_TAG_SYSTEM,
    MONGO_GROUP_MEMBER_TAG_CODE
} = require('../../../utils/mongoGroupExtendedTag');

const GROUP_COLLECTION_NAME = 'Group_4_0_0';

describe('Group search -- groupSize|extended tag reflection', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    function baseGroupMeta () {
        return {
            source: 'http://test-system.com/Group',
            security: [
                { system: 'https://www.icanbwell.com/owner', code: 'test-owner' },
                { system: 'https://www.icanbwell.com/access', code: 'test-access' }
            ]
        };
    }

    async function createGroup (request) {
        const createResp = await request
            .post('/4_0_0/Group')
            .send({
                resourceType: 'Group',
                meta: baseGroupMeta(),
                type: 'person',
                actual: true
            })
            .set(getHeaders());
        expect(createResp).toHaveStatusCode(201);
        return createResp.body.id;
    }

    async function markGroupExtended (groupId) {
        const container = getTestContainer();
        const fhirDb = await container.mongoDatabaseManager.getClientDbAsync();
        await fhirDb.collection(GROUP_COLLECTION_NAME).updateOne(
            { id: groupId },
            { $set: { [MONGO_GROUP_EXTENDED_FIELD]: true } }
        );
    }

    function extendedTagMatcher () {
        return expect.objectContaining({
            system: MONGO_GROUP_MEMBER_TAG_SYSTEM,
            code: MONGO_GROUP_MEMBER_TAG_CODE
        });
    }

    test('list search reflects the groupSize|extended tag only for externalized Groups', async () => {
        const request = await createTestRequest();

        const extendedGroupId = await createGroup(request);
        await markGroupExtended(extendedGroupId);
        const embeddedGroupId = await createGroup(request);

        const resp = await request
            .get(`/4_0_0/Group?_id=${extendedGroupId},${embeddedGroupId}`)
            .set(getHeaders());

        expect(resp.status).toBe(200);
        const body = JSON.parse(resp.text);
        expect(Array.isArray(body)).toBe(true);
        expect(body).toHaveLength(2);

        const extendedResource = body.find((r) => r.id === extendedGroupId);
        const embeddedResource = body.find((r) => r.id === embeddedGroupId);

        expect(extendedResource.meta.tag).toEqual(
            expect.arrayContaining([extendedTagMatcher()])
        );
        expect(embeddedResource.meta.tag || []).not.toEqual(
            expect.arrayContaining([extendedTagMatcher()])
        );
    });

    test('a client-submitted meta.tag omitting the extended entry has no effect -- it is recomputed from the internal field', async () => {
        const request = await createTestRequest();

        const groupId = await createGroup(request);
        await markGroupExtended(groupId);

        const updateResp = await request
            .put(`/4_0_0/Group/${groupId}`)
            .send({
                resourceType: 'Group',
                id: groupId,
                meta: baseGroupMeta(),
                type: 'person',
                actual: true
            })
            .set(getHeaders());
        expect(updateResp).toHaveStatusCode(200);

        const resp = await request
            .get(`/4_0_0/Group?_id=${groupId}`)
            .set(getHeaders());

        expect(resp.status).toBe(200);
        const body = JSON.parse(resp.text);
        const resource = body.find((r) => r.id === groupId);
        expect(resource.meta.tag).toEqual(
            expect.arrayContaining([extendedTagMatcher()])
        );
    });
});
