const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');
const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    createTestRequest,
    getTestContainer,
    mockHttpContext
} = require('../common');

describe('Group promotion to extended storage', () => {
    let requestId;

    beforeEach(async () => {
        await commonBeforeEach();
        requestId = mockHttpContext();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    function baseGroupMeta() {
        return {
            source: 'http://test-system.com/Group',
            security: [
                { system: 'https://www.icanbwell.com/owner', code: 'test-owner' },
                { system: 'https://www.icanbwell.com/access', code: 'test-access' }
            ]
        };
    }

    function membersOfSize(n) {
        return Array.from({ length: n }, (_, i) => ({ entity: { reference: `Patient/member-${i}` } }));
    }

    test('creating a Group with member[] already over the limit is rejected', async () => {
        const request = await createTestRequest();
        const container = getTestContainer();
        const originalLimit = container.configManager.groupMemberLimit;
        // temporarily lower the limit via env override so the test doesn't need 50000 fixtures
        process.env.MAX_GROUP_MEMBERS_PER_PUT = '5';
        try {
            const createResp = await request
                .post('/4_0_0/Group')
                .send({
                    resourceType: 'Group',
                    id: 'over-limit-on-create',
                    meta: baseGroupMeta(),
                    type: 'person',
                    actual: true,
                    member: membersOfSize(6)
                })
                .set(getHeaders());
            expect(createResp).toHaveStatusCode(400);
            expect(createResp.body.issue[0].code).toBe('too-costly');
            // guidance must not claim $member-add can substitute for this CREATE call itself --
            // it can't, since $member-add operates on an existing Group by id. It only mentions
            // $member-add as how to grow membership afterward, once the Group exists.
            expect(createResp.body.issue[0].diagnostics).toContain('$member-add');
            expect(createResp.body.issue[0].diagnostics).not.toContain('instead of this call');
        } finally {
            process.env.MAX_GROUP_MEMBERS_PER_PUT = String(originalLimit);
        }
    });

    test('updating an existing Group to push member[] over the limit is rejected', async () => {
        const request = await createTestRequest();
        const container = getTestContainer();
        const originalLimit = container.configManager.groupMemberLimit;
        process.env.MAX_GROUP_MEMBERS_PER_PUT = '5';
        try {
            const createResp = await request
                .post('/4_0_0/Group')
                .send({
                    resourceType: 'Group',
                    id: 'over-limit-on-update',
                    meta: baseGroupMeta(),
                    type: 'person',
                    actual: true,
                    member: membersOfSize(3)
                })
                .set(getHeaders());
            expect(createResp).toHaveStatusCode(201);

            // a single PUT replacing member[] with an over-limit array in one shot is exactly the
            // "bulk single write" case this task rejects -- not an incremental $member-add crossing
            const updateResp = await request
                .put('/4_0_0/Group/over-limit-on-update')
                .send({
                    resourceType: 'Group',
                    id: 'over-limit-on-update',
                    meta: baseGroupMeta(),
                    type: 'person',
                    actual: true,
                    member: membersOfSize(6)
                })
                .set(getHeaders());
            expect(updateResp).toHaveStatusCode(400);
            expect(updateResp.body.issue[0].code).toBe('too-costly');
            expect(updateResp.body.issue[0].diagnostics).toContain('$member-add');
        } finally {
            process.env.MAX_GROUP_MEMBERS_PER_PUT = String(originalLimit);
        }
    });

    test('$member-add incrementally crossing the limit on an embedded Group is not rejected by the invariant check', async () => {
        const request = await createTestRequest();
        const container = getTestContainer();
        const originalLimit = container.configManager.groupMemberLimit;
        process.env.MAX_GROUP_MEMBERS_PER_PUT = '5';
        try {
            const createResp = await request
                .post('/4_0_0/Group')
                .send({
                    resourceType: 'Group',
                    id: 'incremental-cross-embedded',
                    meta: baseGroupMeta(),
                    type: 'person',
                    actual: true,
                    member: membersOfSize(5)
                })
                .set(getHeaders());
            expect(createResp).toHaveStatusCode(201);
            const createdGroupId = createResp.body.id;

            // crosses the limit (5 -> 6) via the incremental $member-add path, not a bulk PUT --
            // Task B1's reject check must exempt this so Task B3 can promote it instead
            const addResp = await request
                .post(`/4_0_0/Group/${createdGroupId}/$member-add`)
                .send({
                    resourceType: 'Parameters',
                    parameter: [{ name: 'member', valueReference: { reference: 'Patient/member-over-limit' } }]
                })
                .set(getHeaders());
            expect(addResp).toHaveStatusCode(200);
        } finally {
            process.env.MAX_GROUP_MEMBERS_PER_PUT = String(originalLimit);
        }
    });
});
