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
    GROUP_MEMBER_COLLECTION_NAME
} = require('../../../constants');

describe('Group GET streaming read (extended storage)', () => {
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

    async function createExtendedGroup(request, requestedGroupId) {
        const createResp = await request
            .post('/4_0_0/Group')
            .send({
                resourceType: 'Group',
                id: requestedGroupId,
                meta: baseGroupMeta([
                    { system: MONGO_GROUP_MEMBER_TAG_SYSTEM, code: MONGO_GROUP_MEMBER_TAG_CODE }
                ]),
                type: 'person',
                actual: true
            })
            .set(getHeaders());
        expect(createResp).toHaveStatusCode(201);
        const groupId = createResp.body.id;

        const container = getTestContainer();
        await container.postRequestProcessor.waitTillDoneAsync({ requestId });
        const fhirDb = await container.mongoDatabaseManager.getClientDbAsync();
        const groupDoc = await fhirDb.collection('Group_4_0_0').findOne({ id: groupId });
        return { groupId, groupUuid: groupDoc && groupDoc._uuid, fhirDb };
    }

    async function seedGroupMemberRows(fhirDb, rows) {
        await fhirDb.collection(GROUP_MEMBER_COLLECTION_NAME).insertMany(rows);
    }

    test('extended Group streams its roster in memberRowUuid order, including an inactive row', async () => {
        const request = await createTestRequest();

        const { groupId, groupUuid, fhirDb } = await createExtendedGroup(
            request,
            'streaming-read-extended-group'
        );

        await seedGroupMemberRows(fhirDb, [
            {
                id: 'ccc-row',
                meta: { versionId: '1', lastUpdated: new Date() },
                _sourceAssigningAuthority: 'test-authority',
                groupUuid,
                memberRowUuid: 'ccc-row',
                groupVersionId: 1,
                member: {
                    entity: {
                        reference: 'Patient/streaming-member-3',
                        _uuid: 'deadbeef-0000-0000-0000-000000000000',
                        _sourceId: 'streaming-member-3'
                    },
                    inactive: false
                }
            },
            {
                id: 'aaa-row',
                meta: { versionId: '1', lastUpdated: new Date() },
                _sourceAssigningAuthority: 'test-authority',
                groupUuid,
                memberRowUuid: 'aaa-row',
                groupVersionId: 1,
                member: {
                    entity: { reference: 'Patient/streaming-member-1' },
                    inactive: false
                }
            },
            {
                id: 'bbb-row',
                meta: { versionId: '1', lastUpdated: new Date() },
                _sourceAssigningAuthority: 'test-authority',
                groupUuid,
                memberRowUuid: 'bbb-row',
                groupVersionId: 1,
                member: {
                    entity: { reference: 'Patient/streaming-member-2' },
                    inactive: true
                }
            }
        ]);

        const resp = await request
            .get(`/4_0_0/Group/${groupId}`)
            .set(getHeaders());

        expect(resp.status).toBe(200);
        expect(resp.headers['content-type']).toContain('application/fhir+json');

        const body = JSON.parse(resp.text);

        expect(body.resourceType).toBe('Group');
        expect(body.id).toBe(groupId);
        expect(body.type).toBe('person');
        expect(body.actual).toBe(true);
        expect(body.meta).toBeDefined();
        expect(body.meta.tag).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    system: MONGO_GROUP_MEMBER_TAG_SYSTEM,
                    code: MONGO_GROUP_MEMBER_TAG_CODE
                })
            ])
        );

        expect(Array.isArray(body.member)).toBe(true);
        expect(body.member).toHaveLength(3);
        const simplifiedMembers = body.member.map((m) => ({
            reference: m.entity.reference,
            inactive: !!m.inactive
        }));
        expect(simplifiedMembers).toEqual([
            { reference: 'Patient/streaming-member-1', inactive: false },
            { reference: 'Patient/streaming-member-2', inactive: true },
            { reference: 'Patient/streaming-member-3', inactive: false }
        ]);

        const thirdMemberEntity = body.member[2].entity;
        expect(thirdMemberEntity._uuid).toBeUndefined();
        expect(thirdMemberEntity._sourceId).toBeUndefined();
        expect(thirdMemberEntity.reference).toBe('Patient/streaming-member-3');
    });

    test('extended Group with zero GroupMember_4_0_0 rows returns member: [] rather than missing/undefined', async () => {
        const request = await createTestRequest();

        const { groupId } = await createExtendedGroup(request, 'streaming-read-extended-empty-group');

        const resp = await request
            .get(`/4_0_0/Group/${groupId}`)
            .set(getHeaders());

        expect(resp.status).toBe(200);
        expect(resp.headers['content-type']).toContain('application/fhir+json');

        const body = JSON.parse(resp.text);
        expect(body.resourceType).toBe('Group');
        expect(body.id).toBe(groupId);
        expect(Array.isArray(body.member)).toBe(true);
        expect(body.member).toHaveLength(0);
    });

    test('GET on an extended Group is rejected when ENABLE_EXTENDED_GROUP is disabled', async () => {
        const request = await createTestRequest();

        const { groupId } = await createExtendedGroup(request, 'streaming-read-flag-disabled');

        const previousValue = process.env.ENABLE_EXTENDED_GROUP;
        delete process.env.ENABLE_EXTENDED_GROUP;
        try {
            const resp = await request
                .get(`/4_0_0/Group/${groupId}`)
                .set(getHeaders());
            expect(resp).toHaveStatusCode(400);
        } finally {
            process.env.ENABLE_EXTENDED_GROUP = previousValue;
        }
    });

    test('normal (embedded) Group is unaffected -- member[] stays inline as before', async () => {
        const request = await createTestRequest();

        const createResp = await request
            .post('/4_0_0/Group')
            .send({
                resourceType: 'Group',
                id: 'streaming-read-embedded-group',
                meta: baseGroupMeta(),
                type: 'person',
                actual: true,
                member: [
                    { entity: { reference: 'Patient/embedded-member-1' } },
                    { entity: { reference: 'Patient/embedded-member-2' }, inactive: true }
                ]
            })
            .set(getHeaders());
        expect(createResp).toHaveStatusCode(201);
        const groupId = createResp.body.id;

        const resp = await request
            .get(`/4_0_0/Group/${groupId}`)
            .set(getHeaders());

        expect(resp.status).toBe(200);
        const body = resp.body;
        expect(body.resourceType).toBe('Group');
        expect(Array.isArray(body.member)).toBe(true);
        const simplifiedMembers = body.member.map((m) => ({
            reference: m.entity.reference,
            inactive: !!m.inactive
        }));
        expect(simplifiedMembers).toEqual(
            expect.arrayContaining([
                { reference: 'Patient/embedded-member-1', inactive: false },
                { reference: 'Patient/embedded-member-2', inactive: true }
            ])
        );
    });
});
