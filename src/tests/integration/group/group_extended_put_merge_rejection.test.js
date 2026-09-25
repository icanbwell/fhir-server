/**
 * Extended Group PUT/$merge rejection (DCON-5527, design doc §5.1)
 *
 * An extended Group's roster lives entirely in GroupMember_4_0_0 -- member[] doesn't exist on
 * the live document. A PUT or $merge that submits a `member` field against an extended Group is
 * rejected outright, before anything is persisted; a PUT/$merge that omits `member` still
 * updates the Group's other fields normally. Membership itself only ever changes through PATCH
 * (see group_member_patch_write.test.js).
 *
 * ENABLE_EXTENDED_GROUP is set to '1' globally in jest/setEnvVars.js.
 */
const { describe, test, beforeAll, afterAll, expect } = require('@jest/globals');
const { commonBeforeEach, commonAfterEach, createTestRequest, getTestContainer, getHeaders } = require('../common');
const { MONGO_GROUP_EXTENDED_FIELD } = require('../../../utils/mongoGroupExtendedTag');

const GROUP_COLLECTION_NAME = 'Group_4_0_0';

function defaultMeta(extraTags = []) {
    return {
        source: 'http://test-system.com/Group',
        security: [
            { system: 'https://www.icanbwell.com/owner', code: 'test-owner' },
            { system: 'https://www.icanbwell.com/access', code: 'test-access' }
        ],
        tag: extraTags
    };
}

describe('Extended Group PUT/$merge rejection (DCON-5527)', () => {
    let request;

    beforeAll(async () => {
        await commonBeforeEach();
        request = await createTestRequest();
    });

    afterAll(async () => {
        await commonAfterEach();
    });

    async function createGroup(overrides = {}) {
        const response = await request
            .post('/4_0_0/Group')
            .send({
                resourceType: 'Group',
                type: 'person',
                actual: true,
                meta: defaultMeta(),
                ...overrides
            })
            .set(getHeaders());
        expect(response.status).toBe(201);
        return response.body;
    }

    async function getCollection(name) {
        const container = getTestContainer();
        const db = await container.mongoDatabaseManager.getClientDbAsync();
        return db.collection(name);
    }

    /**
     * Puts a Group into the extended (Mongo-native) regime the way the design doc (§3.1, §7)
     * says tests should: a raw write of the internal, non-FHIR marker field directly on the
     * Group document -- never via meta.tag, which is not the source of truth.
     */
    async function markGroupExtended(groupId) {
        const groupCollection = await getCollection(GROUP_COLLECTION_NAME);
        await groupCollection.updateOne(
            { id: groupId },
            { $set: { [MONGO_GROUP_EXTENDED_FIELD]: true } }
        );
    }

    describe('PUT', () => {
        test('rejects a PUT that submits member against an extended Group', async () => {
            const created = await createGroup();
            await markGroupExtended(created.id);

            const putResp = await request
                .put(`/4_0_0/Group/${created.id}`)
                .send({
                    resourceType: 'Group',
                    id: created.id,
                    type: 'person',
                    actual: true,
                    meta: defaultMeta(),
                    member: [{ entity: { reference: 'Patient/should-be-rejected' } }]
                })
                .set(getHeaders());

            expect(putResp.status).toBe(400);
            expect(putResp.body.resourceType).toBe('OperationOutcome');

            // Nothing was persisted -- the Group's version/name are untouched.
            const groupCollection = await getCollection(GROUP_COLLECTION_NAME);
            const groupDoc = await groupCollection.findOne({ id: created.id });
            expect(groupDoc.meta.versionId).toBe(created.meta.versionId);
        });

        test('still rejects a member-carrying PUT even when ENABLE_EXTENDED_GROUP is disabled', async () => {
            // The rejection is a data-integrity guardrail on the internal marker, not a feature
            // gate (design doc §5.1) -- unlike PATCH's own member-ops routing, which does throw a
            // different "feature disabled" error in this same flag-off state.
            const created = await createGroup();
            await markGroupExtended(created.id);

            const saved = process.env.ENABLE_EXTENDED_GROUP;
            delete process.env.ENABLE_EXTENDED_GROUP;
            try {
                const putResp = await request
                    .put(`/4_0_0/Group/${created.id}`)
                    .send({
                        resourceType: 'Group',
                        id: created.id,
                        type: 'person',
                        actual: true,
                        meta: defaultMeta(),
                        member: [{ entity: { reference: 'Patient/should-be-rejected' } }]
                    })
                    .set(getHeaders());
                expect(putResp.status).toBe(400);
            } finally {
                process.env.ENABLE_EXTENDED_GROUP = saved;
            }
        });

        test('allows a metadata-only PUT (no member field) against an extended Group', async () => {
            const created = await createGroup({ name: 'original-name' });
            await markGroupExtended(created.id);

            const putResp = await request
                .put(`/4_0_0/Group/${created.id}`)
                .send({
                    resourceType: 'Group',
                    id: created.id,
                    type: 'person',
                    actual: true,
                    name: 'updated-name',
                    meta: defaultMeta()
                })
                .set(getHeaders());

            expect(putResp.status).toBe(200);
            expect(putResp.body.name).toBe('updated-name');
            expect(putResp.body.member).toBeUndefined();

            // Still extended -- the metadata-only PUT didn't disturb the internal marker.
            const groupCollection = await getCollection(GROUP_COLLECTION_NAME);
            const groupDoc = await groupCollection.findOne({ id: created.id });
            expect(groupDoc[MONGO_GROUP_EXTENDED_FIELD]).toBe(true);
        });
    });

    describe('$merge', () => {
        test('rejects a $merge that submits member against an extended Group', async () => {
            const created = await createGroup();
            await markGroupExtended(created.id);

            const mergeResp = await request
                .post('/4_0_0/Group/$merge')
                .send({
                    resourceType: 'Group',
                    id: created.id,
                    type: 'person',
                    actual: true,
                    meta: defaultMeta(),
                    member: [{ entity: { reference: 'Patient/should-be-rejected' } }]
                })
                .set(getHeaders());

            expect(mergeResp.status).toBe(200);
            expect(mergeResp.body).toEqual(expect.objectContaining({ created: false, updated: false }));

            const groupCollection = await getCollection(GROUP_COLLECTION_NAME);
            const groupDoc = await groupCollection.findOne({ id: created.id });
            expect(groupDoc.meta.versionId).toBe(created.meta.versionId);
        });

        test('still rejects a member-carrying $merge even when ENABLE_EXTENDED_GROUP is disabled', async () => {
            const created = await createGroup();
            await markGroupExtended(created.id);

            const saved = process.env.ENABLE_EXTENDED_GROUP;
            delete process.env.ENABLE_EXTENDED_GROUP;
            try {
                const mergeResp = await request
                    .post('/4_0_0/Group/$merge')
                    .send({
                        resourceType: 'Group',
                        id: created.id,
                        type: 'person',
                        actual: true,
                        meta: defaultMeta(),
                        member: [{ entity: { reference: 'Patient/should-be-rejected' } }]
                    })
                    .set(getHeaders());
                expect(mergeResp.status).toBe(200);
                expect(mergeResp.body).toEqual(expect.objectContaining({ created: false, updated: false }));
            } finally {
                process.env.ENABLE_EXTENDED_GROUP = saved;
            }
        });

        test('allows a metadata-only $merge (no member field) against an extended Group', async () => {
            const created = await createGroup({ name: 'original-name' });
            await markGroupExtended(created.id);

            const mergeResp = await request
                .post('/4_0_0/Group/$merge')
                .send({
                    resourceType: 'Group',
                    id: created.id,
                    type: 'person',
                    actual: true,
                    name: 'updated-name',
                    meta: defaultMeta()
                })
                .set(getHeaders());

            expect(mergeResp.status).toBe(200);
            expect(mergeResp.body).toEqual(expect.objectContaining({ updated: true }));

            const groupCollection = await getCollection(GROUP_COLLECTION_NAME);
            const groupDoc = await groupCollection.findOne({ id: created.id });
            expect(groupDoc.name).toBe('updated-name');
            expect(groupDoc[MONGO_GROUP_EXTENDED_FIELD]).toBe(true);
        });
    });
});
