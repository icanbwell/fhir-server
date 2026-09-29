/**
 * FHIR search coverage for an extended (Mongo-native) Group.
 *
 * An extended Group's roster lives in GroupMember_4_0_0 and member[] does not exist on the Group
 * document at all. Every Group search parameter that targets a field still on the document is
 * therefore unaffected; the one that targets the roster is not.
 *
 * R4 defines ten search parameters for Group. Nine resolve against the Group document (actual,
 * characteristic, code, exclude, identifier, managing-entity, type, value, characteristic-value).
 * One, `member`, resolves against `member.entity`, which for an extended Group is not there.
 *
 * This suite pins the whole boundary so it is explicit rather than discovered later. The
 * document-scoped parameters must keep working. The `member` cases describe the reverse lookup
 * the analytics and matching use cases depend on: a failure there is the gap itself, not a
 * broken test.
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
const MEMBER_REFERENCE = 'Patient/coverage-member-1';

describe('FHIR search coverage for an extended Group', () => {
    let extendedGroupId;

    beforeAll(async () => {
        await setupGroupTests();
        await cleanupAllData();
    }, 60000);

    afterAll(async () => {
        await teardownGroupTests();
    });

    async function getDb() {
        const container = getTestContainer();
        return container.mongoDatabaseManager.getClientDbAsync();
    }

    async function createExtendedGroupWithMember() {
        const request = getSharedRequest();

        const createResponse = await request
            .post('/4_0_0/Group')
            .send({
                resourceType: 'Group',
                type: 'person',
                actual: true,
                name: 'Coverage Probe Group',
                identifier: [{ system: 'http://test-system.com/group-id', value: 'coverage-probe-1' }],
                code: { coding: [{ system: 'http://test-system.com/group-code', code: 'cohort' }] },
                managingEntity: { reference: 'Organization/coverage-org-1' },
                characteristic: [
                    {
                        code: {
                            coding: [{ system: 'http://test-system.com/char', code: 'age-band' }]
                        },
                        valueBoolean: true,
                        exclude: false
                    }
                ],
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
        const groupId = createResponse.body.id;

        // Put the Group into the extended regime the way the other extended suites do: a raw
        // write of the internal marker, never meta.tag.
        const db = await getDb();
        await db
            .collection(GROUP_COLLECTION_NAME)
            .updateOne({ id: groupId }, { $set: { [MONGO_GROUP_EXTENDED_FIELD]: true } });

        // Add a member through the only supported extended write path.
        const patchResponse = await request
            .patch(`/4_0_0/Group/${groupId}`)
            .send([{ op: 'add', path: '/member/-', value: { entity: { reference: MEMBER_REFERENCE } } }])
            .set(getHeadersJsonPatch());
        expect(patchResponse.status).toBe(200);

        // Precondition: the roster really is in the member collection, not inline.
        const memberRows = await db.collection(GROUP_MEMBER_COLLECTION_NAME).find({}).toArray();
        expect(memberRows.length).toBeGreaterThan(0);

        return groupId;
    }

    beforeEach(async () => {
        await cleanupAllData();
        extendedGroupId = await createExtendedGroupWithMember();
    }, 60000);

    async function search(queryString) {
        return getSharedRequest().get(`/4_0_0/Group?${queryString}`).set(getTestHeaders());
    }

    function idsIn(response) {
        return (response.body?.entry || []).map((e) => e.resource?.id);
    }

    describe('parameters resolving against the Group document', () => {
        test('_id', async () => {
            const response = await search(`_id=${extendedGroupId}`);
            expect(response.status).toBe(200);
            expect(idsIn(response)).toContain(extendedGroupId);
        });

        test('type', async () => {
            const response = await search('type=person');
            expect(response.status).toBe(200);
            expect(idsIn(response)).toContain(extendedGroupId);
        });

        test('actual', async () => {
            const response = await search('actual=true');
            expect(response.status).toBe(200);
            expect(idsIn(response)).toContain(extendedGroupId);
        });

        test('identifier', async () => {
            const response = await search(
                'identifier=http://test-system.com/group-id|coverage-probe-1'
            );
            expect(response.status).toBe(200);
            expect(idsIn(response)).toContain(extendedGroupId);
        });

        test('code', async () => {
            const response = await search('code=http://test-system.com/group-code|cohort');
            expect(response.status).toBe(200);
            expect(idsIn(response)).toContain(extendedGroupId);
        });

        test('characteristic', async () => {
            const response = await search('characteristic=http://test-system.com/char|age-band');
            expect(response.status).toBe(200);
            expect(idsIn(response)).toContain(extendedGroupId);
        });

        test('managing-entity', async () => {
            const response = await search('managing-entity=Organization/coverage-org-1');
            expect(response.status).toBe(200);
            expect(idsIn(response)).toContain(extendedGroupId);
        });
    });

    describe('reverse lookup against the roster', () => {
        test('member finds the extended Group by full reference', async () => {
            const response = await search(`member=${MEMBER_REFERENCE}`);
            expect(response.status).toBe(200);
            expect(idsIn(response)).toContain(extendedGroupId);
        });

        test('member finds the extended Group by bare id', async () => {
            const response = await search('member=coverage-member-1');
            expect(response.status).toBe(200);
            expect(idsIn(response)).toContain(extendedGroupId);
        });

        test('member does not match a reference that was never added', async () => {
            const response = await search('member=Patient/never-added-anywhere');
            expect(response.status).toBe(200);
            expect(idsIn(response)).not.toContain(extendedGroupId);
        });
    });
});
