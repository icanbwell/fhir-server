/**
 * Verifies that sending the useExternalStorage header has NO effect
 * when ClickHouse is disabled (ENABLE_CLICKHOUSE=0).
 * Members stay in MongoDB, no tag added, no stripping.
 */

const { describe, test, beforeAll, afterAll, expect } = require('@jest/globals');
const { commonBeforeEach, commonAfterEach, createTestRequest, getHeaders } = require('../common');
const { USE_EXTERNAL_STORAGE_HEADER } = require('../../utils/contextDataBuilder');
const { EXTERNAL_STORAGE_TAG_SYSTEM } = require('../../utils/clickHouseGroupPreSave');

function getHeadersWithExternalStorage() {
    return { ...getHeaders(), [USE_EXTERNAL_STORAGE_HEADER]: 'true' };
}

const defaultMeta = {
    source: 'http://test-system.com/Group',
    security: [
        { system: 'https://www.icanbwell.com/owner', code: 'test-owner' },
        { system: 'https://www.icanbwell.com/access', code: 'test-access' }
    ]
};

describe('Header ignored when ClickHouse disabled', () => {
    let savedEnableClickHouse;
    let savedResources;

    beforeAll(async () => {
        savedEnableClickHouse = process.env.ENABLE_CLICKHOUSE;
        savedResources = process.env.MONGO_WITH_CLICKHOUSE_RESOURCES;
        process.env.ENABLE_CLICKHOUSE = '0';
        delete process.env.MONGO_WITH_CLICKHOUSE_RESOURCES;
        await commonBeforeEach();
    });

    afterAll(async () => {
        if (savedEnableClickHouse !== undefined) {
            process.env.ENABLE_CLICKHOUSE = savedEnableClickHouse;
        } else {
            delete process.env.ENABLE_CLICKHOUSE;
        }
        if (savedResources !== undefined) {
            process.env.MONGO_WITH_CLICKHOUSE_RESOURCES = savedResources;
        }
        await commonAfterEach();
    });

    function hasExternalStorageTag(group) {
        return (group.meta?.tag || []).some(
            t => t.system === EXTERNAL_STORAGE_TAG_SYSTEM
        );
    }

    async function getGroupFromMongo(groupId) {
        const request = await createTestRequest();
        const response = await request
            .get(`/4_0_0/Group/${groupId}`)
            .set(getHeaders());
        expect(response.status).toBe(200);
        return response.body;
    }

    test('CREATE with header but env disabled: members preserved, no tag', async () => {
        const request = await createTestRequest();
        const createRes = await request
            .post('/4_0_0/Group')
            .send({
                resourceType: 'Group', type: 'person', actual: true,
                member: [
                    { entity: { reference: 'Patient/disabled-create-1' } },
                    { entity: { reference: 'Patient/disabled-create-2' } }
                ],
                meta: defaultMeta
            })
            .set(getHeadersWithExternalStorage());
        expect(createRes.status).toBe(201);

        const mongoGroup = await getGroupFromMongo(createRes.body.id);
        expect(mongoGroup.member).toBeDefined();
        expect(mongoGroup.member.length).toBe(2);
        expect(hasExternalStorageTag(mongoGroup)).toBe(false);
    });

    test('PUT with header but env disabled: members preserved, no tag', async () => {
        const request0 = await createTestRequest();
        const createRes = await request0
            .post('/4_0_0/Group')
            .send({
                resourceType: 'Group', type: 'person', actual: true,
                member: [{ entity: { reference: 'Patient/disabled-put-1' } }],
                meta: defaultMeta
            })
            .set(getHeadersWithExternalStorage());
        expect(createRes.status).toBe(201);
        const groupId = createRes.body.id;

        const request = await createTestRequest();
        const putRes = await request
            .put(`/4_0_0/Group/${groupId}`)
            .send({
                resourceType: 'Group', id: groupId, type: 'person', actual: true,
                member: [
                    { entity: { reference: 'Patient/disabled-put-1' } },
                    { entity: { reference: 'Patient/disabled-put-2' } }
                ],
                meta: defaultMeta
            })
            .set(getHeadersWithExternalStorage());
        expect([200, 201]).toContain(putRes.status);

        const mongoGroup = await getGroupFromMongo(groupId);
        expect(mongoGroup.member).toBeDefined();
        expect(mongoGroup.member.length).toBe(2);
        expect(hasExternalStorageTag(mongoGroup)).toBe(false);
    });

    test('PATCH with header but env disabled: members preserved, no tag', async () => {
        const request0 = await createTestRequest();
        const createRes = await request0
            .post('/4_0_0/Group')
            .send({
                resourceType: 'Group', type: 'person', actual: true,
                member: [{ entity: { reference: 'Patient/disabled-patch-1' } }],
                meta: defaultMeta
            })
            .set(getHeadersWithExternalStorage());
        expect(createRes.status).toBe(201);
        const groupId = createRes.body.id;

        const request = await createTestRequest();
        const patchRes = await request
            .patch(`/4_0_0/Group/${groupId}`)
            .send([{ op: 'add', path: '/member/-', value: { entity: { reference: 'Patient/disabled-patch-2' } } }])
            .set(getHeadersWithExternalStorage())
            .set('Content-Type', 'application/json-patch+json');
        expect(patchRes.status).toBe(200);

        const mongoGroup = await getGroupFromMongo(groupId);
        expect(mongoGroup.member).toBeDefined();
        // Standard FHIR PATCH applies: original 1 member + 1 added = 2
        expect(mongoGroup.member.length).toBe(2);
        expect(hasExternalStorageTag(mongoGroup)).toBe(false);
    });

    test('$merge with header but env disabled: members preserved, no tag', async () => {
        const request0 = await createTestRequest();
        const createRes = await request0
            .post('/4_0_0/Group')
            .send({
                resourceType: 'Group', type: 'person', actual: true,
                member: [{ entity: { reference: 'Patient/disabled-merge-1' } }],
                meta: defaultMeta
            })
            .set(getHeadersWithExternalStorage());
        expect(createRes.status).toBe(201);
        const groupId = createRes.body.id;

        const request = await createTestRequest();
        const mergeRes = await request
            .post('/4_0_0/Group/$merge')
            .send({
                resourceType: 'Group', id: groupId, type: 'person', actual: true,
                member: [
                    { entity: { reference: 'Patient/disabled-merge-1' } },
                    { entity: { reference: 'Patient/disabled-merge-2' } }
                ],
                meta: defaultMeta
            })
            .set(getHeadersWithExternalStorage());
        expect([200, 201]).toContain(mergeRes.status);

        const mongoGroup = await getGroupFromMongo(groupId);
        expect(mongoGroup.member).toBeDefined();
        // Standard merge behavior — member array updated by resourceMerger
        expect(mongoGroup.member.length).toBe(2);
        expect(hasExternalStorageTag(mongoGroup)).toBe(false);
    });
});
