/**
 * An embedded Group keeps one member for each entity.reference, however it is written: POST, PUT,
 * $merge or PATCH. Entries are the same member when their reference resolves to the same uuid,
 * so `Patient/x` and `Patient/x|<owner>` match and the same id under another owner does not.
 * A POST, PUT or $merge Group that lists a member more than once is rejected, whatever storage
 * its members go to. A member sent again that is already stored is merged onto the stored entry,
 * and members stored more than once are merged on the next write that changes the Group.
 */
const { describe, test, beforeAll, afterAll, expect } = require('@jest/globals');
const { commonBeforeEach, commonAfterEach, createTestRequest, getTestContainer, getHeaders, getHeadersJsonPatch } = require('../common');
const { USE_EXTERNAL_STORAGE_HEADER } = require('../../../utils/contextDataBuilder');

const GROUP_COLLECTION_NAME = 'Group_4_0_0';
const OWNER = 'test-owner';
const PERIOD = { start: '2026-01-01' };

const meta = {
    source: 'http://test-system.com/Group',
    security: [
        { system: 'https://www.icanbwell.com/owner', code: OWNER },
        { system: 'https://www.icanbwell.com/access', code: 'test-access' }
    ]
};

function member(reference, extra = {}) {
    return { entity: { reference }, ...extra };
}

/**
 * toEqual ignores fields that are undefined, so an expected entry lists only the fields it has.
 * @param {Object[]} members
 * @returns {{reference: string, period: Object|undefined, inactive: boolean|undefined}[]}
 */
function memberSummary(members) {
    return (members || []).map((m) => ({ reference: m.entity.reference, period: m.period, inactive: m.inactive }));
}

describe('Group keeps one member per entity.reference', () => {
    let request;

    beforeAll(async () => {
        await commonBeforeEach();
        request = await createTestRequest();
    });

    afterAll(async () => {
        await commonAfterEach();
    });

    function groupBody(id, extra = {}) {
        return { resourceType: 'Group', id, type: 'person', actual: true, name: 'before', meta, ...extra };
    }

    /**
     * POST assigns the Group's id, so the id the server returns is the one to read and write.
     * @returns {Promise<string>}
     */
    async function postGroup(members, headers = getHeaders()) {
        const response = await request.post('/4_0_0/Group').send(groupBody(undefined, { member: members })).set(headers);
        expect(response.status).toBe(201);
        return response.body.id;
    }

    async function getGroup(id) {
        const response = await request.get(`/4_0_0/Group/${id}`).set(getHeaders());
        expect(response.status).toBe(200);
        return response.body;
    }

    async function getGroupCollection() {
        const db = await getTestContainer().mongoDatabaseManager.getClientDbAsync();
        return db.collection(GROUP_COLLECTION_NAME);
    }

    /**
     * Writes member[] straight to the stored Group, bypassing the server, to stand in for a Group
     * saved with duplicate members before they were merged on write. Each entry takes the
     * server-computed entity fields (_uuid, _sourceId, ...) of the stored entry with its reference.
     */
    async function storeMembersDirectly(id, members) {
        const groupCollection = await getGroupCollection();
        const storedGroup = await groupCollection.findOne({ id });
        const storedEntityByReference = new Map(storedGroup.member.map((m) => [m.entity.reference, m.entity]));
        const stampedMember = (m) => ({ ...m, entity: { ...storedEntityByReference.get(m.entity.reference) } });
        const result = await groupCollection.updateOne({ id }, { $set: { member: members.map(stampedMember) } });
        expect(result.modifiedCount).toBe(1);
    }

    async function mergeGroup(body) {
        const response = await request.post('/4_0_0/Group/$merge').send(body).set(getHeaders());
        expect(response.status).toBe(200);
        return response.body;
    }

    function expectRepeatedMemberOutcome(operationOutcome, expectedExpression) {
        expect(operationOutcome.issue).toHaveLength(1);
        expect(operationOutcome.issue[0]).toMatchObject({ severity: 'error', code: 'invalid', expression: expectedExpression });
    }

    async function countGroups() {
        return (await getGroupCollection()).countDocuments({ name: 'before' });
    }

    test.each([
        ['the same reference twice', [member('Patient/a'), member('Patient/a', { period: PERIOD })], ['Group.member[0]', 'Group.member[1]']],
        [
            'the plain and the |owner form of one reference',
            [member('Patient/a'), member('Patient/b'), member(`Patient/a|${OWNER}`)],
            ['Group.member[0]', 'Group.member[2]']
        ]
    ])('POST listing %s is rejected and stores nothing', async (_label, members, expectedExpression) => {
        const groupCountBefore = await countGroups();

        const response = await request.post('/4_0_0/Group').send(groupBody(undefined, { member: members })).set(getHeaders());

        expect(response.status).toBe(400);
        expectRepeatedMemberOutcome(response.body, expectedExpression);
        expect(await countGroups()).toBe(groupCountBefore);
    });

    test('PUT listing a member twice is rejected and leaves the Group as stored', async () => {
        const id = await postGroup([member('Patient/b')]);

        const response = await request
            .put(`/4_0_0/Group/${id}`)
            .send(groupBody(id, { member: [member('Patient/a'), member('Patient/a', { period: PERIOD })] }))
            .set(getHeaders());

        expect(response.status).toBe(400);
        expectRepeatedMemberOutcome(response.body, ['Group.member[0]', 'Group.member[1]']);
        const group = await getGroup(id);
        expect(memberSummary(group.member)).toEqual([{ reference: 'Patient/b' }]);
        expect(group.meta.versionId).toBe('1');
    });

    test('$merge of a Group listing a member twice returns an error for it and leaves it as stored', async () => {
        const id = await postGroup([member('Patient/b')]);

        const mergeResult = await mergeGroup(groupBody(id, { member: [member('Patient/a'), member('Patient/a', { period: PERIOD })] }));

        expect(mergeResult).toMatchObject({ id, created: false, updated: false });
        expectRepeatedMemberOutcome(mergeResult.operationOutcome, ['Group.member[0]', 'Group.member[1]']);
        const group = await getGroup(id);
        expect(memberSummary(group.member)).toEqual([{ reference: 'Patient/b' }]);
        expect(group.meta.versionId).toBe('1');
    });

    test.each([
        [
            'an existing Group',
            async () => postGroup([member('Patient/b')]),
            [{ reference: 'Patient/b' }, { reference: 'Patient/a', period: PERIOD }]
        ],
        ['a new Group', async () => 'group-created-by-two-entries', [{ reference: 'Patient/a', period: PERIOD }]]
    ])('$merge of two entries for %s, each listing the same member once, keeps one entry for it', async (_label, groupIdFor, expectedMembers) => {
        const id = await groupIdFor();

        await mergeGroup([groupBody(id, { member: [member('Patient/a')] }), groupBody(id, { member: [member('Patient/a', { period: PERIOD })] })]);

        const group = await getGroup(id);
        expect(memberSummary(group.member)).toEqual(expectedMembers);
    });

    test.each([
        [
            're-sending a member with a period',
            [member('Patient/a'), member('Patient/b')],
            [member('Patient/a', { period: PERIOD })],
            [{ reference: 'Patient/a', period: PERIOD }, { reference: 'Patient/b' }],
            '2'
        ],
        [
            're-sending a member with fewer fields',
            [member('Patient/a', { period: PERIOD }), member('Patient/b')],
            [member('Patient/a')],
            [{ reference: 'Patient/a', period: PERIOD }, { reference: 'Patient/b' }],
            '1'
        ],
        [
            'sending a period with only a start, which merges with the stored end',
            [member('Patient/a', { period: { start: '2024-01-01', end: '2024-06-30' } })],
            [member('Patient/a', { period: PERIOD })],
            [{ reference: 'Patient/a', period: { ...PERIOD, end: '2024-06-30' } }],
            '2'
        ]
    ])('$merge %s keeps one entry per member', async (_label, storedMembers, sentMembers, expectedMembers, expectedVersionId) => {
        const id = await postGroup(storedMembers);

        await mergeGroup(groupBody(id, { member: sentMembers }));

        const group = await getGroup(id);
        expect(memberSummary(group.member)).toEqual(expectedMembers);
        expect(group.meta.versionId).toBe(expectedVersionId);
    });

    test('$merge re-sending a member in the id|sourceAssigningAuthority form keeps one entry for it', async () => {
        const id = await postGroup([member('Patient/a'), member('Patient/b')]);

        await mergeGroup(groupBody(id, { member: [member(`Patient/a|${OWNER}`, { period: PERIOD })] }));

        const group = await getGroup(id);
        expect(group.member).toHaveLength(2);
        const memberA = group.member.filter((m) => m.entity.reference.startsWith('Patient/a'));
        expect(memberA).toHaveLength(1);
        expect(memberA[0].period).toEqual(PERIOD);
    });

    test('the same patient id under two owners stays two members', async () => {
        const id = await postGroup([member('Patient/a|owner-one'), member('Patient/a|owner-two')]);

        const group = await getGroup(id);

        expect(group.member).toHaveLength(2);
    });

    test.each([
        ['$merge changing name', async (id) => mergeGroup(groupBody(id, { name: 'after' }))],
        [
            'PATCH replace /name',
            async (id) => {
                const response = await request
                    .patch(`/4_0_0/Group/${id}`)
                    .send([{ op: 'replace', path: '/name', value: 'after' }])
                    .set(getHeadersJsonPatch());
                expect(response.status).toBe(200);
            }
        ]
    ])('a %s merges members already stored twice, once', async (_label, write) => {
        const id = await postGroup([member('Patient/a'), member('Patient/b')]);
        await storeMembersDirectly(id, [member('Patient/a'), member('Patient/b'), member('Patient/a', { period: PERIOD })]);

        await write(id);
        const groupAfterFirstWrite = await getGroup(id);
        await write(id);
        const groupAfterSecondWrite = await getGroup(id);

        expect(memberSummary(groupAfterFirstWrite.member)).toEqual([
            { reference: 'Patient/a', period: PERIOD },
            { reference: 'Patient/b' }
        ]);
        expect(groupAfterFirstWrite.name).toBe('after');
        expect(groupAfterFirstWrite.meta.versionId).toBe('2');
        expect(groupAfterSecondWrite.meta.versionId).toBe('2');
    });

    test.each([
        [
            'add /member/2/inactive',
            [{ op: 'add', path: '/member/2/inactive', value: true }],
            [{ reference: 'Patient/a', period: PERIOD }, { reference: 'Patient/b', inactive: true }]
        ],
        [
            'remove /member/0',
            [{ op: 'remove', path: '/member/0' }],
            [{ reference: 'Patient/a', period: PERIOD }, { reference: 'Patient/b' }]
        ]
    ])('PATCH %s on members stored twice applies to the entries as stored, then merges them', async (_label, patchOps, expectedMembers) => {
        const id = await postGroup([member('Patient/a'), member('Patient/b')]);
        await storeMembersDirectly(id, [member('Patient/a'), member('Patient/a', { period: PERIOD }), member('Patient/b')]);

        const response = await request.patch(`/4_0_0/Group/${id}`).send(patchOps).set(getHeadersJsonPatch());

        expect(response.status).toBe(200);
        const group = await getGroup(id);
        expect(memberSummary(group.member)).toEqual(expectedMembers);
    });

    test('a POST with the useexternalstorage header listing a member twice is rejected too', async () => {
        const response = await request
            .post('/4_0_0/Group')
            .send(groupBody(undefined, { member: [member('Patient/a'), member('Patient/a', { period: PERIOD })] }))
            .set({ ...getHeaders(), [USE_EXTERNAL_STORAGE_HEADER]: 'true' });

        expect(response.status).toBe(400);
        expectRepeatedMemberOutcome(response.body, ['Group.member[0]', 'Group.member[1]']);
    });

    test('$merge matching a member by id on a Group storing that member twice keeps the sent values', async () => {
        const id = await postGroup([member('Patient/a'), member('Patient/b')]);
        await storeMembersDirectly(id, [
            member('Patient/a', { id: 'member-a' }),
            member('Patient/a', { period: { start: '2025-01-01' } }),
            member('Patient/b')
        ]);

        await mergeGroup(groupBody(id, { member: [member('Patient/a', { id: 'member-a', period: PERIOD })] }));

        const group = await getGroup(id);
        expect(memberSummary(group.member)).toEqual([{ reference: 'Patient/a', period: PERIOD }, { reference: 'Patient/b' }]);
    });

    test('a $merge that changes nothing leaves members stored twice as they are and creates no version', async () => {
        const id = await postGroup([member('Patient/a'), member('Patient/b')]);
        await storeMembersDirectly(id, [member('Patient/a'), member('Patient/b'), member('Patient/a', { period: PERIOD })]);

        await mergeGroup(groupBody(id, { member: [member('Patient/b')] }));

        const groupCollection = await getGroupCollection();
        const storedGroup = await groupCollection.findOne({ id });
        expect(storedGroup.member).toHaveLength(3);
        expect(storedGroup.meta.versionId).toBe('1');
    });
});
