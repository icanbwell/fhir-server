/**
 * Client injection of the internal extended-regime marker on create.
 *
 * The extended-regime marker is an internal, non-FHIR field that decides where a Group's roster
 * lives, and therefore which read path serves it. The design's stated guarantee (§3.1) is that a
 * client body can never set or unset it.
 *
 * PATCH is covered by patchInternalFieldsValidator, which rejects any path starting with '_'.
 * PUT/$merge is covered by resourceMerger.overWriteNonWritableFields, which carries the stored
 * value forward over whatever the client submitted. Create has neither: there is no stored
 * resource to carry a value forward from, and the field is a declared, settable property on the
 * generated Group class.
 *
 * If the marker sticks on create, a caller can stand up a Group that the read path treats as
 * extended while its roster is actually inline on the document, so the submitted members become
 * unreachable through the API.
 */
const { describe, test, beforeAll, afterAll, expect } = require('@jest/globals');
const { commonBeforeEach, commonAfterEach, createTestRequest, getTestContainer, getHeaders } = require('../common');
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

describe('Extended-regime marker is not client-writable on create', () => {
    let request;

    beforeAll(async () => {
        await commonBeforeEach();
        request = await createTestRequest();
    });

    afterAll(async () => {
        await commonAfterEach();
    });

    async function getGroupCollection() {
        const container = getTestContainer();
        const db = await container.mongoDatabaseManager.getClientDbAsync();
        return db.collection(GROUP_COLLECTION_NAME);
    }

    /**
     * A FHIR create assigns the id server-side, so the caller has to read it back off the
     * response rather than assuming the submitted one was honored.
     */
    async function createGroupWithInjectedMarker(memberReference) {
        const response = await request
            .post('/4_0_0/Group')
            .send({
                resourceType: 'Group',
                type: 'person',
                actual: true,
                meta: defaultMeta(),
                [MONGO_GROUP_EXTENDED_FIELD]: true,
                member: [{ entity: { reference: memberReference } }]
            })
            .set(getHeaders());

        expect(response.status).toBe(201);
        const createdId = response.body?.id || response.headers.location?.split('/')[3];
        expect(createdId).toBeTruthy();
        return createdId;
    }

    test('a create body carrying the internal marker does not persist it', async () => {
        const createdId = await createGroupWithInjectedMarker('Patient/injection-p1');

        const groupCollection = await getGroupCollection();
        const doc = await groupCollection.findOne({ id: createdId });

        expect(doc).toBeTruthy();
        expect(doc[MONGO_GROUP_EXTENDED_FIELD]).not.toBe(true);
    });

    test('members submitted alongside an injected marker remain readable', async () => {
        const createdId = await createGroupWithInjectedMarker('Patient/injection-p2');

        const readResponse = await request.get(`/4_0_0/Group/${createdId}`).set(getHeaders());

        expect(readResponse.status).toBe(200);
        // The roster was written inline, so it must come back inline. An extended read would
        // stream from GroupMember_4_0_0, which has no rows for this Group, and silently return
        // an empty member array.
        expect(readResponse.body.member).toHaveLength(1);
        expect(readResponse.body.member[0].entity.reference).toContain('injection-p2');
    });
});
