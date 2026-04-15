

const { describe, test, beforeAll, beforeEach, afterAll, expect } = require('@jest/globals');
const { EVENT_TYPES } = require('../../constants/clickHouseConstants');
const { USE_EXTERNAL_MEMBER_STORAGE_HEADER } = require('../../utils/contextDataBuilder');
const { EXTERNAL_STORAGE_TAG_SYSTEM, EXTERNAL_STORAGE_TAG_CODE } = require('../../utils/clickHouseGroupPreSave');
const {
    setupGroupTests,
    teardownGroupTests,
    cleanupAllData,
    getSharedRequest,
    getClickHouseManager,
    getTestHeaders
} = require('./groupTestSetup');

function getHeadersWithExternalStorage() {
    return { ...getTestHeaders(), [USE_EXTERNAL_MEMBER_STORAGE_HEADER]: 'true' };
}

let ORIGINAL_ENABLE_MERGE_FAST_SERIALIZER;

describe('Fast Merge Member Preservation (ENABLE_MERGE_FAST_SERIALIZER)', () => {
    let clickHouseManager;

    beforeAll(async () => {
        ORIGINAL_ENABLE_MERGE_FAST_SERIALIZER = process.env.ENABLE_MERGE_FAST_SERIALIZER;
        process.env.ENABLE_MERGE_FAST_SERIALIZER = '1';
        await setupGroupTests();
        clickHouseManager = getClickHouseManager();
    });

    afterAll(async () => {
        process.env.ENABLE_MERGE_FAST_SERIALIZER = ORIGINAL_ENABLE_MERGE_FAST_SERIALIZER;
    });

    beforeEach(async () => {
        await cleanupAllData();
    });

    afterAll(async () => {
        await teardownGroupTests();
    });

    const defaultMeta = {
        source: 'http://test-system.com/Group',
        security: [
            { system: 'https://www.icanbwell.com/owner', code: 'test-owner' },
            { system: 'https://www.icanbwell.com/access', code: 'test-access' }
        ]
    };

    async function createGroupWithHeader(group) {
        const request = getSharedRequest();
        const response = await request
            .post('/4_0_0/Group')
            .send({ resourceType: 'Group', ...group, meta: group.meta || defaultMeta })
            .set(getHeadersWithExternalStorage());
        expect(response.status).toBe(201);
        return response.body;
    }

    async function getGroupFromMongo(groupId) {
        const request = getSharedRequest();
        const response = await request
            .get(`/4_0_0/Group/${groupId}`)
            .set(getTestHeaders());
        expect(response.status).toBe(200);
        return response.body;
    }

    async function getClickHouseEventCount(groupId, eventType) {
        const events = await clickHouseManager.queryAsync({
            query: `SELECT count() as count FROM fhir.Group_4_0_0_MemberEvents
                    WHERE group_id = '${groupId}' AND event_type = '${eventType}'`
        });
        return parseInt(events[0].count);
    }

    function hasExternalStorageTag(group) {
        return (group.meta?.tag || []).some(
            t => t.system === EXTERNAL_STORAGE_TAG_SYSTEM && t.code === EXTERNAL_STORAGE_TAG_CODE
        );
    }

    test('$merge smartMerge=true: preserves MongoDB, ClickHouse adds only', async () => {
        // Create group WITHOUT header (members in MongoDB)
        const request0 = getSharedRequest();
        const createRes = await request0
            .post('/4_0_0/Group')
            .send({
                resourceType: 'Group',
                type: 'person',
                actual: true,
                member: [
                    { entity: { reference: 'Patient/fast-ser-1' } },
                    { entity: { reference: 'Patient/fast-ser-2' } }
                ],
                meta: defaultMeta
            })
            .set(getTestHeaders());
        expect(createRes.status).toBe(201);
        const groupId = createRes.body.id;

        // Verify MongoDB has members, no tag
        const before = await getGroupFromMongo(groupId);
        expect(before.member).toBeDefined();
        expect(before.member.length).toBe(2);
        expect(hasExternalStorageTag(before)).toBe(false);

        // $merge with header (smartMerge=true is default)
        const request = getSharedRequest();
        const mergeResponse = await request
            .post('/4_0_0/Group/$merge')
            .send({
                resourceType: 'Group',
                id: groupId,
                type: 'person',
                actual: true,
                member: [
                    { entity: { reference: 'Patient/fast-ser-1' } },
                    { entity: { reference: 'Patient/fast-ser-new-3' } }
                ],
                meta: defaultMeta
            })
            .set(getHeadersWithExternalStorage());
        expect([200, 201]).toContain(mergeResponse.status);

        // MongoDB: members preserved
        const after = await getGroupFromMongo(groupId);
        expect(after.member).toBeDefined();
        const mongoRefs = after.member.map(m => m.entity.reference);
        expect(mongoRefs).toEqual(
            expect.arrayContaining(['Patient/fast-ser-1', 'Patient/fast-ser-2'])
        );

        // Tag added
        expect(hasExternalStorageTag(after)).toBe(true);

        // ClickHouse: only 1 new add, no removals
        const addedCount = await getClickHouseEventCount(groupId, EVENT_TYPES.MEMBER_ADDED);
        expect(addedCount).toBe(1);

        const removedCount = await getClickHouseEventCount(groupId, EVENT_TYPES.MEMBER_REMOVED);
        expect(removedCount).toBe(0);
    });

    test('$merge smartMerge=false: strips members, ClickHouse has diff', async () => {
        const created = await createGroupWithHeader({
            type: 'person',
            actual: true,
            member: [
                { entity: { reference: 'Patient/fast-ser-full-1' } },
                { entity: { reference: 'Patient/fast-ser-full-2' } }
            ]
        });

        // $merge with smartMerge=false
        const request = getSharedRequest();
        const mergeResponse = await request
            .post('/4_0_0/Group/$merge?smartMerge=false')
            .send({
                resourceType: 'Group',
                id: created.id,
                type: 'person',
                actual: true,
                member: [
                    { entity: { reference: 'Patient/fast-ser-full-1' } },
                    { entity: { reference: 'Patient/fast-ser-full-new-3' } }
                ],
                meta: defaultMeta
            })
            .set(getHeadersWithExternalStorage());
        expect([200, 201]).toContain(mergeResponse.status);

        // MongoDB: members stripped (smartMerge=false)
        const mongoGroup = await getGroupFromMongo(created.id);
        expect(mongoGroup.member).toBeUndefined();

        // ClickHouse: 2 original + 1 new add + 1 removal
        const addedCount = await getClickHouseEventCount(created.id, EVENT_TYPES.MEMBER_ADDED);
        expect(addedCount).toBe(3);

        const removedCount = await getClickHouseEventCount(created.id, EVENT_TYPES.MEMBER_REMOVED);
        expect(removedCount).toBe(1);
    });
});
