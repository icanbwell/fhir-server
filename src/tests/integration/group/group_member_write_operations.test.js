const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');
const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    createTestRequest,
    getTestContainer,
    mockHttpContext
} = require('../common');
const {
    MONGO_GROUP_MEMBER_TAG_SYSTEM,
    MONGO_GROUP_MEMBER_TAG_CODE
} = require('../../../utils/mongoGroupExtendedTag');
const {
    GROUP_MEMBER_COLLECTION_NAME,
    GROUP_MEMBER_HISTORY_COLLECTION_NAME
} = require('../../../constants');

/**
 * Happy-path coverage for DCON-5527's $member-add / $member-remove on Group:
 * - an embedded Group (default regime), mutating member[] inline
 * - an extended Group (groupSize|extended tag), writing through to the
 *   GroupMember_4_0_0 / GroupMember_4_0_0_History collections
 */
describe('Group $member-add / $member-remove', () => {
    let requestId;

    beforeEach(async () => {
        await commonBeforeEach();
        requestId = mockHttpContext();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    function baseGroupMeta(extraTags = []) {
        return {
            source: 'http://test-system.com/Group',
            security: [
                { system: 'https://www.icanbwell.com/owner', code: 'test-owner' },
                { system: 'https://www.icanbwell.com/access', code: 'test-access' }
            ],
            tag: extraTags
        };
    }

    test('member-add then member-remove on an embedded Group mutates member[] inline', async () => {
        const request = await createTestRequest();
        const groupId = 'embedded-happy-path-group';
        const existingMemberRef = 'Patient/existing-member-1';
        const newMemberRef = 'Patient/new-member-1';

        const createResp = await request
            .post('/4_0_0/Group')
            .send({
                resourceType: 'Group',
                id: groupId,
                meta: baseGroupMeta(),
                type: 'person',
                actual: true,
                member: [
                    { entity: { reference: existingMemberRef } }
                ]
            })
            .set(getHeaders());
        expect(createResp).toHaveStatusCode(201);
        const createdGroupId = createResp.body.id;
        const initialVersionId = parseInt(createResp.body.meta.versionId, 10);

        const addResp = await request
            .post(`/4_0_0/Group/${createdGroupId}/$member-add`)
            .send({
                resourceType: 'Parameters',
                parameter: [
                    { name: 'member', valueReference: { reference: newMemberRef } }
                ]
            })
            .set(getHeaders());

        expect(addResp).toHaveStatusCode(200);
        expect(addResp.body.resourceType).toBe('Group');
        expect(parseInt(addResp.body.meta.versionId, 10)).toBeGreaterThan(initialVersionId);

        const memberRefsAfterAdd = addResp.body.member.map((m) => m.entity.reference);
        expect(memberRefsAfterAdd).toEqual(expect.arrayContaining([existingMemberRef, newMemberRef]));
        const addedMember = addResp.body.member.find((m) => m.entity.reference === newMemberRef);
        expect(addedMember.inactive).toBeFalsy();

        const removeResp = await request
            .post(`/4_0_0/Group/${createdGroupId}/$member-remove`)
            .send({
                resourceType: 'Parameters',
                parameter: [
                    { name: 'member', valueReference: { reference: newMemberRef } }
                ]
            })
            .set(getHeaders());

        expect(removeResp).toHaveStatusCode(200);
        // embedded regime: $member-remove hard-removes the entry from member[] entirely
        const removedMember = removeResp.body.member.find((m) => m.entity.reference === newMemberRef);
        expect(removedMember).toBeUndefined();

        // the untouched, pre-existing member stays active and stays in the array
        const untouchedMember = removeResp.body.member.find((m) => m.entity.reference === existingMemberRef);
        expect(untouchedMember).toBeDefined();
        expect(untouchedMember.inactive).toBeFalsy();
    });

    test('member-add then member-remove on an extended Group writes through to GroupMember collections', async () => {
        const request = await createTestRequest();
        const container = getTestContainer();
        const groupId = 'extended-happy-path-group';
        const memberRef = 'Patient/extended-member-1';

        const createResp = await request
            .post('/4_0_0/Group')
            .send({
                resourceType: 'Group',
                id: groupId,
                meta: baseGroupMeta([
                    { system: MONGO_GROUP_MEMBER_TAG_SYSTEM, code: MONGO_GROUP_MEMBER_TAG_CODE }
                ]),
                type: 'person',
                actual: true
            })
            .set(getHeaders());
        expect(createResp).toHaveStatusCode(201);
        const createdGroupId = createResp.body.id;

        const mongoDatabaseManager = container.mongoDatabaseManager;
        const fhirDb = await mongoDatabaseManager.getClientDbAsync();
        const groupDoc = await fhirDb.collection('Group_4_0_0').findOne({ id: createdGroupId });
        const groupUuid = groupDoc._uuid;

        const addResp = await request
            .post(`/4_0_0/Group/${createdGroupId}/$member-add`)
            .send({
                resourceType: 'Parameters',
                parameter: [
                    { name: 'member', valueReference: { reference: memberRef } }
                ]
            })
            .set(getHeaders());
        expect(addResp).toHaveStatusCode(200);
        // an extended Group's roster lives in GroupMember_4_0_0, not inline
        expect(addResp.body.member).toBeUndefined();

        await container.postRequestProcessor.waitTillDoneAsync({ requestId });

        const memberCollection = fhirDb.collection(GROUP_MEMBER_COLLECTION_NAME);
        const historyCollection = fhirDb.collection(GROUP_MEMBER_HISTORY_COLLECTION_NAME);

        const rowAfterAdd = await memberCollection.findOne({ groupUuid, 'member.entity.reference': memberRef });
        expect(rowAfterAdd).toBeDefined();
        expect(rowAfterAdd.member.inactive).toBe(false);

        const historyAfterAdd = await historyCollection.find({ 'resource.groupUuid': groupUuid }).toArray();
        expect(historyAfterAdd).toHaveLength(1);
        expect(historyAfterAdd[0].resource.operation).toBe('create');

        const removeResp = await request
            .post(`/4_0_0/Group/${createdGroupId}/$member-remove`)
            .send({
                resourceType: 'Parameters',
                parameter: [
                    { name: 'member', valueReference: { reference: memberRef } }
                ]
            })
            .set(getHeaders());
        expect(removeResp).toHaveStatusCode(200);

        await container.postRequestProcessor.waitTillDoneAsync({ requestId });

        const rowAfterRemove = await memberCollection.findOne({ groupUuid, 'member.entity.reference': memberRef });
        expect(rowAfterRemove.member.inactive).toBe(true);

        const historyAfterRemove = await historyCollection.find({ 'resource.groupUuid': groupUuid }).toArray();
        expect(historyAfterRemove).toHaveLength(2);
        expect(historyAfterRemove.map((h) => h.resource.operation).sort()).toEqual(['create', 'deactivate']);
    });

    test('member-add and member-remove are not registered for a non-Group resourceType', async () => {
        const request = await createTestRequest();
        const patientId = 'not-a-group';

        const createResp = await request
            .post('/4_0_0/Patient')
            .send({
                resourceType: 'Patient',
                id: patientId,
                meta: baseGroupMeta()
            })
            .set(getHeaders());
        expect(createResp).toHaveStatusCode(201);

        const addResp = await request
            .post(`/4_0_0/Patient/${patientId}/$member-add`)
            .send({
                resourceType: 'Parameters',
                parameter: [
                    { name: 'member', valueReference: { reference: 'Patient/some-other-patient' } }
                ]
            })
            .set(getHeaders());
        // the route itself only exists on Group's operation list (see generate_services.py) --
        // Express never reaches GroupMemberWriteOperation's own resourceType==='Group' assertion
        expect(addResp).toHaveStatusCode(404);

        const removeResp = await request
            .post(`/4_0_0/Patient/${patientId}/$member-remove`)
            .send({
                resourceType: 'Parameters',
                parameter: [
                    { name: 'member', valueReference: { reference: 'Patient/some-other-patient' } }
                ]
            })
            .set(getHeaders());
        expect(removeResp).toHaveStatusCode(404);
    });

    test('member-add on an extended Group is rejected when ENABLE_EXTENDED_GROUP is disabled', async () => {
        const request = await createTestRequest();
        const groupId = 'extended-group-flag-disabled';
        const memberRef = 'Patient/flag-disabled-member';

        const createResp = await request
            .post('/4_0_0/Group')
            .send({
                resourceType: 'Group',
                id: groupId,
                meta: baseGroupMeta([
                    { system: MONGO_GROUP_MEMBER_TAG_SYSTEM, code: MONGO_GROUP_MEMBER_TAG_CODE }
                ]),
                type: 'person',
                actual: true
            })
            .set(getHeaders());
        expect(createResp).toHaveStatusCode(201);

        const previousValue = process.env.ENABLE_EXTENDED_GROUP;
        delete process.env.ENABLE_EXTENDED_GROUP;
        try {
            const addResp = await request
                .post(`/4_0_0/Group/${groupId}/$member-add`)
                .send({
                    resourceType: 'Parameters',
                    parameter: [
                        { name: 'member', valueReference: { reference: memberRef } }
                    ]
                })
                .set(getHeaders());
            expect(addResp).toHaveStatusCode(400);
        } finally {
            process.env.ENABLE_EXTENDED_GROUP = previousValue;
        }
    });

    test('member-add with more member parameters than the op-count limit is rejected as too-costly', async () => {
        const request = await createTestRequest();
        const container = getTestContainer();
        const groupId = 'member-add-over-op-limit';

        const createResp = await request
            .post('/4_0_0/Group')
            .send({
                resourceType: 'Group',
                id: groupId,
                meta: baseGroupMeta(),
                type: 'person',
                actual: true
            })
            .set(getHeaders());
        expect(createResp).toHaveStatusCode(201);

        const previousLimit = process.env.GROUP_PATCH_OPERATIONS_LIMIT;
        process.env.GROUP_PATCH_OPERATIONS_LIMIT = '3';
        try {
            const addResp = await request
                .post(`/4_0_0/Group/${groupId}/$member-add`)
                .send({
                    resourceType: 'Parameters',
                    parameter: Array.from({ length: 4 }, (_, i) => ({
                        name: 'member',
                        valueReference: { reference: `Patient/over-limit-member-${i}` }
                    }))
                })
                .set(getHeaders());
            expect(addResp).toHaveStatusCode(400);
            expect(addResp.body.issue[0].code).toBe('too-costly');
            expect(addResp.body.issue[0].diagnostics).toContain('4 > 3');

            // the rejected request must not have partially applied -- no members present at all
            const fhirDb = await container.mongoDatabaseManager.getClientDbAsync();
            const groupDoc = await fhirDb.collection('Group_4_0_0').findOne({ id: groupId });
            expect(groupDoc.member || []).toHaveLength(0);
        } finally {
            process.env.GROUP_PATCH_OPERATIONS_LIMIT = previousLimit;
        }
    });
});
