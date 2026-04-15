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

/**
 * MongoDB Member Behavior Tests
 *
 * Expected behavior with useExternalMemberStorage header:
 *
 * | Operation              | MongoDB members            | ClickHouse events              |
 * |------------------------|----------------------------|--------------------------------|
 * | CREATE (header)        | member: [] (not stored)    | MEMBER_ADDED for all           |
 * | PUT (header)           | member: [] (not stored)    | Diff: adds + removes           |
 * | PATCH (header)         | Preserved (unchanged)      | Events from PATCH ops only     |
 * | $merge smartMerge=true | Preserved (unchanged)      | Adds only, no removals         |
 * | $merge smartMerge=false| member: [] (not stored)    | Diff: adds + removes           |
 */
describe('MongoDB Member Behavior with ClickHouse', () => {
    let clickHouseManager;

    beforeAll(async () => {
        await setupGroupTests();
        clickHouseManager = getClickHouseManager();
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
        // GET without external storage header reads from MongoDB directly
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

    // ==================== CREATE ====================

    test('CREATE with header: MongoDB has no members, ClickHouse has events', async () => {
        const created = await createGroupWithHeader({
            type: 'person',
            actual: true,
            member: [
                { entity: { reference: 'Patient/create-1' } },
                { entity: { reference: 'Patient/create-2' } }
            ]
        });

        // MongoDB should NOT have members (ClickHouse is the source of truth)
        const mongoGroup = await getGroupFromMongo(created.id);
        expect(mongoGroup.member).toBeUndefined();

        // ClickHouse should have MEMBER_ADDED events
        const addedCount = await getClickHouseEventCount(created.id, EVENT_TYPES.MEMBER_ADDED);
        expect(addedCount).toBe(2);
    });

    // ==================== PATCH ====================

    test('PATCH with header: MongoDB members preserved, ClickHouse gets add event', async () => {
        // Create group WITHOUT header (members stored in MongoDB)
        const request0 = getSharedRequest();
        const createRes = await request0
            .post('/4_0_0/Group')
            .send({
                resourceType: 'Group',
                type: 'person',
                actual: true,
                member: [
                    { entity: { reference: 'Patient/patch-keep-1' } },
                    { entity: { reference: 'Patient/patch-keep-2' } }
                ],
                meta: defaultMeta
            })
            .set(getTestHeaders());
        expect(createRes.status).toBe(201);
        const groupId = createRes.body.id;

        // Verify MongoDB has 2 members before PATCH
        const mongoBefore = await getGroupFromMongo(groupId);
        expect(mongoBefore.member).toBeDefined();
        expect(mongoBefore.member.length).toBe(2);

        // PATCH with header to add a new member
        const request = getSharedRequest();
        const patchResponse = await request
            .patch(`/4_0_0/Group/${groupId}`)
            .send([{ op: 'add', path: '/member/-', value: { entity: { reference: 'Patient/patch-new-3' } } }])
            .set(getHeadersWithExternalStorage())
            .set('Content-Type', 'application/json-patch+json');
        expect(patchResponse.status).toBe(200);

        // MongoDB should still have original 2 members (PATCH preserves them)
        const mongoAfter = await getGroupFromMongo(groupId);
        expect(mongoAfter.member).toBeDefined();
        expect(mongoAfter.member.length).toBe(2);
        expect(mongoAfter.member.map(m => m.entity.reference)).toEqual(
            expect.arrayContaining(['Patient/patch-keep-1', 'Patient/patch-keep-2'])
        );

        // ClickHouse should have 1 MEMBER_ADDED event (from patch only, not from create)
        const addedCount = await getClickHouseEventCount(groupId, EVENT_TYPES.MEMBER_ADDED);
        expect(addedCount).toBe(1);
    });

    // ==================== PUT ====================

    test('PUT with header: MongoDB has no members, ClickHouse has diff events', async () => {
        const created = await createGroupWithHeader({
            type: 'person',
            actual: true,
            member: [
                { entity: { reference: 'Patient/put-1' } },
                { entity: { reference: 'Patient/put-2' } },
                { entity: { reference: 'Patient/put-3' } }
            ]
        });

        // PUT with only 2 members (removes put-2, put-3, adds put-new-4)
        const request = getSharedRequest();
        const putResponse = await request
            .put(`/4_0_0/Group/${created.id}`)
            .send({
                resourceType: 'Group',
                id: created.id,
                type: 'person',
                actual: true,
                member: [
                    { entity: { reference: 'Patient/put-1' } },
                    { entity: { reference: 'Patient/put-new-4' } }
                ],
                meta: defaultMeta
            })
            .set(getHeadersWithExternalStorage());
        expect([200, 201]).toContain(putResponse.status);

        // MongoDB should NOT have members after PUT with header
        const mongoGroup = await getGroupFromMongo(created.id);
        expect(mongoGroup.member).toBeUndefined();

        // ClickHouse: 3 original adds + 1 new add + 2 removals
        const addedCount = await getClickHouseEventCount(created.id, EVENT_TYPES.MEMBER_ADDED);
        expect(addedCount).toBe(4); // 3 from create + 1 new (put-new-4)

        const removedCount = await getClickHouseEventCount(created.id, EVENT_TYPES.MEMBER_REMOVED);
        expect(removedCount).toBe(2); // put-2 and put-3 removed
    });

    // ==================== $merge (smartMerge=true) ====================

    test('$merge smartMerge=true: MongoDB members preserved, ClickHouse adds only', async () => {
        // Create group WITHOUT header (members stored in MongoDB)
        const request0 = getSharedRequest();
        const createRes = await request0
            .post('/4_0_0/Group')
            .send({
                resourceType: 'Group',
                type: 'person',
                actual: true,
                member: [
                    { entity: { reference: 'Patient/merge-smart-1' } },
                    { entity: { reference: 'Patient/merge-smart-2' } }
                ],
                meta: defaultMeta
            })
            .set(getTestHeaders());
        expect(createRes.status).toBe(201);
        const groupId = createRes.body.id;

        // $merge with smartMerge=true (default), sending 1 original + 1 new
        const request = getSharedRequest();
        const mergeResponse = await request
            .post('/4_0_0/Group/$merge')
            .send({
                resourceType: 'Group',
                id: groupId,
                type: 'person',
                actual: true,
                member: [
                    { entity: { reference: 'Patient/merge-smart-1' } },
                    { entity: { reference: 'Patient/merge-smart-new-3' } }
                ],
                meta: defaultMeta
            })
            .set(getHeadersWithExternalStorage());
        expect([200, 201]).toContain(mergeResponse.status);

        // MongoDB should preserve original members (smartMerge keeps them)
        const mongoGroup = await getGroupFromMongo(groupId);
        expect(mongoGroup.member).toBeDefined();
        const mongoRefs = mongoGroup.member.map(m => m.entity.reference);
        expect(mongoRefs).toEqual(
            expect.arrayContaining(['Patient/merge-smart-1', 'Patient/merge-smart-2'])
        );

        // ClickHouse should have 1 add (merge-smart-new-3) and NO removals
        const addedCount = await getClickHouseEventCount(groupId, EVENT_TYPES.MEMBER_ADDED);
        expect(addedCount).toBe(1); // only new member

        const removedCount = await getClickHouseEventCount(groupId, EVENT_TYPES.MEMBER_REMOVED);
        expect(removedCount).toBe(0); // smartMerge=true: no removals
    });

    // ==================== $merge (smartMerge=false) ====================

    test('$merge smartMerge=false: MongoDB has no members, ClickHouse has diff events', async () => {
        const created = await createGroupWithHeader({
            type: 'person',
            actual: true,
            member: [
                { entity: { reference: 'Patient/merge-full-1' } },
                { entity: { reference: 'Patient/merge-full-2' } }
            ]
        });

        // $merge with smartMerge=false, keep 1 + add 1 new
        const request = getSharedRequest();
        const mergeResponse = await request
            .post('/4_0_0/Group/$merge?smartMerge=false')
            .send({
                resourceType: 'Group',
                id: created.id,
                type: 'person',
                actual: true,
                member: [
                    { entity: { reference: 'Patient/merge-full-1' } },
                    { entity: { reference: 'Patient/merge-full-new-3' } }
                ],
                meta: defaultMeta
            })
            .set(getHeadersWithExternalStorage());
        expect([200, 201]).toContain(mergeResponse.status);

        // MongoDB should NOT have members (smartMerge=false = full replacement)
        const mongoGroup = await getGroupFromMongo(created.id);
        expect(mongoGroup.member).toBeUndefined();

        // ClickHouse: 2 original adds + 1 new add + 1 removal
        const addedCount = await getClickHouseEventCount(created.id, EVENT_TYPES.MEMBER_ADDED);
        expect(addedCount).toBe(3); // 2 from create + 1 new (merge-full-new-3)

        const removedCount = await getClickHouseEventCount(created.id, EVENT_TYPES.MEMBER_REMOVED);
        expect(removedCount).toBe(1); // merge-full-2 removed
    });

    // ==================== externalStorageFields tag ====================

    function hasExternalStorageTag(group) {
        return (group.meta?.tag || []).some(
            t => t.system === EXTERNAL_STORAGE_TAG_SYSTEM && t.code === EXTERNAL_STORAGE_TAG_CODE
        );
    }

    test('CREATE with header: adds externalStorageFields tag', async () => {
        const created = await createGroupWithHeader({
            type: 'person',
            actual: true,
            member: [{ entity: { reference: 'Patient/tag-create-1' } }]
        });

        const mongoGroup = await getGroupFromMongo(created.id);
        expect(hasExternalStorageTag(mongoGroup)).toBe(true);
    });

    test('PATCH with header: adds externalStorageFields tag to existing Group', async () => {
        // Create WITHOUT header (no tag)
        const request0 = getSharedRequest();
        const createRes = await request0
            .post('/4_0_0/Group')
            .send({
                resourceType: 'Group', type: 'person', actual: true,
                member: [{ entity: { reference: 'Patient/tag-patch-1' } }],
                meta: defaultMeta
            })
            .set(getTestHeaders());
        expect(createRes.status).toBe(201);
        const groupId = createRes.body.id;

        // Verify no tag before PATCH
        const before = await getGroupFromMongo(groupId);
        expect(hasExternalStorageTag(before)).toBe(false);

        // PATCH with header
        const request = getSharedRequest();
        await request
            .patch(`/4_0_0/Group/${groupId}`)
            .send([{ op: 'add', path: '/member/-', value: { entity: { reference: 'Patient/tag-patch-2' } } }])
            .set(getHeadersWithExternalStorage())
            .set('Content-Type', 'application/json-patch+json');

        // Tag should now be present
        const after = await getGroupFromMongo(groupId);
        expect(hasExternalStorageTag(after)).toBe(true);
    });

    test('Tag not duplicated on subsequent writes', async () => {
        const created = await createGroupWithHeader({
            type: 'person',
            actual: true,
            member: [{ entity: { reference: 'Patient/tag-dup-1' } }]
        });

        // PUT again with header
        const request = getSharedRequest();
        await request
            .put(`/4_0_0/Group/${created.id}`)
            .send({
                resourceType: 'Group', id: created.id, type: 'person', actual: true,
                member: [{ entity: { reference: 'Patient/tag-dup-2' } }],
                meta: defaultMeta
            })
            .set(getHeadersWithExternalStorage());

        const mongoGroup = await getGroupFromMongo(created.id);
        const tagCount = (mongoGroup.meta?.tag || []).filter(
            t => t.system === EXTERNAL_STORAGE_TAG_SYSTEM
        ).length;
        expect(tagCount).toBe(1);
    });

    test('Tag not added without header', async () => {
        const request0 = getSharedRequest();
        const createRes = await request0
            .post('/4_0_0/Group')
            .send({
                resourceType: 'Group', type: 'person', actual: true,
                member: [{ entity: { reference: 'Patient/tag-no-header-1' } }],
                meta: defaultMeta
            })
            .set(getTestHeaders());
        expect(createRes.status).toBe(201);

        const mongoGroup = await getGroupFromMongo(createRes.body.id);
        expect(hasExternalStorageTag(mongoGroup)).toBe(false);
    });

    // ==================== $merge smartMerge=true with tag verification ====================

    test('$merge smartMerge=true: preserves MongoDB members, adds tag, ClickHouse adds only', async () => {
        // Create group WITHOUT header (members in MongoDB, no tag)
        const request0 = getSharedRequest();
        const createRes = await request0
            .post('/4_0_0/Group')
            .send({
                resourceType: 'Group',
                type: 'person',
                actual: true,
                member: [
                    { entity: { reference: 'Patient/fast-merge-1' } },
                    { entity: { reference: 'Patient/fast-merge-2' } }
                ],
                meta: defaultMeta
            })
            .set(getTestHeaders());
        expect(createRes.status).toBe(201);
        const groupId = createRes.body.id;

        // Verify no tag before merge
        const before = await getGroupFromMongo(groupId);
        expect(hasExternalStorageTag(before)).toBe(false);
        expect(before.member.length).toBe(2);

        // $merge (smartMerge=true is default) with header, add a new member
        const request = getSharedRequest();
        const mergeResponse = await request
            .post('/4_0_0/Group/$merge')
            .send({
                resourceType: 'Group',
                id: groupId,
                type: 'person',
                actual: true,
                member: [
                    { entity: { reference: 'Patient/fast-merge-1' } },
                    { entity: { reference: 'Patient/fast-merge-new-3' } }
                ],
                meta: defaultMeta
            })
            .set(getHeadersWithExternalStorage());
        expect([200, 201]).toContain(mergeResponse.status);

        // MongoDB: members preserved (smartMerge=true doesn't strip)
        const after = await getGroupFromMongo(groupId);
        expect(after.member).toBeDefined();
        const mongoRefs = after.member.map(m => m.entity.reference);
        expect(mongoRefs).toEqual(
            expect.arrayContaining(['Patient/fast-merge-1', 'Patient/fast-merge-2'])
        );

        // Tag added
        expect(hasExternalStorageTag(after)).toBe(true);

        // ClickHouse: only 1 new member added, no removals
        const addedCount = await getClickHouseEventCount(groupId, EVENT_TYPES.MEMBER_ADDED);
        expect(addedCount).toBe(1);

        const removedCount = await getClickHouseEventCount(groupId, EVENT_TYPES.MEMBER_REMOVED);
        expect(removedCount).toBe(0);

        // Second merge — verify idempotent (tag not duplicated, existing members still preserved)
        const request2 = getSharedRequest();
        const mergeResponse2 = await request2
            .post('/4_0_0/Group/$merge')
            .send({
                resourceType: 'Group',
                id: groupId,
                type: 'person',
                actual: true,
                member: [
                    { entity: { reference: 'Patient/fast-merge-new-4' } }
                ],
                meta: defaultMeta
            })
            .set(getHeadersWithExternalStorage());
        expect([200, 201]).toContain(mergeResponse2.status);

        const afterSecond = await getGroupFromMongo(groupId);
        // Members still preserved
        expect(afterSecond.member).toBeDefined();
        const mongoRefs2 = afterSecond.member.map(m => m.entity.reference);
        expect(mongoRefs2).toEqual(
            expect.arrayContaining(['Patient/fast-merge-1', 'Patient/fast-merge-2'])
        );

        // Tag not duplicated
        const tagCount = (afterSecond.meta?.tag || []).filter(
            t => t.system === EXTERNAL_STORAGE_TAG_SYSTEM
        ).length;
        expect(tagCount).toBe(1);

        // ClickHouse: 2 total adds (merge-new-3 + merge-new-4), still no removals
        const finalAddedCount = await getClickHouseEventCount(groupId, EVENT_TYPES.MEMBER_ADDED);
        expect(finalAddedCount).toBe(2);

        const finalRemovedCount = await getClickHouseEventCount(groupId, EVENT_TYPES.MEMBER_REMOVED);
        expect(finalRemovedCount).toBe(0);
    });

});
