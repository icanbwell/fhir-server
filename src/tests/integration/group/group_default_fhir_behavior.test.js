const { describe, test, beforeAll, beforeEach, afterAll, expect } = require('@jest/globals');
const {
    setupGroupTests,
    teardownGroupTests,
    cleanupAllData,
    getSharedRequest,
    getClickHouseManager,
    getTestHeaders
} = require('./groupTestSetup');

/**
 * Default FHIR Behavior Test Suite
 *
 * Verifies that when ClickHouse IS enabled (env vars set) but the
 * useExternalStorage header is ABSENT, Groups behave as standard FHIR:
 * - Members stored inline in MongoDB
 * - Members returned in GET responses
 * - No ClickHouse events written
 * - Standard JSON Patch works on member array
 */
describe('Group default FHIR behavior (no useExternalStorage header)', () => {
    beforeAll(async () => {
        await setupGroupTests();
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

    test('POST Group with members → members stored in MongoDB, returned in response', async () => {
        const request = getSharedRequest();
        const clickHouseManager = getClickHouseManager();

        // Create Group with members using standard headers (NO external storage header)
        const createResponse = await request
            .post('/4_0_0/Group')
            .send({
                resourceType: 'Group',
                type: 'person',
                actual: true,
                name: 'Standard FHIR Group',
                member: [
                    { entity: { reference: 'Patient/test-patient-1' } },
                    { entity: { reference: 'Patient/test-patient-2' } }
                ],
                meta: defaultMeta
            })
            .set(getTestHeaders());

        expect(createResponse.status).toBe(201);
        const groupId = createResponse.body.id;

        // GET should return members inline
        const getResponse = await request.get(`/4_0_0/Group/${groupId}`).set(getTestHeaders());

        expect(getResponse.status).toBe(200);
        expect(getResponse.body.member).toBeDefined();
        expect(getResponse.body.member).toHaveLength(2);
        expect(getResponse.body.member[0].entity.reference).toContain('Patient/');
        expect(getResponse.body.member[1].entity.reference).toContain('Patient/');

        // No ClickHouse events should exist
        const events = await clickHouseManager.queryAsync({
            query: `SELECT count() as count FROM fhir.Group_4_0_0_MemberEvents WHERE group_id = '${groupId}'`
        });
        expect(parseInt(events[0].count)).toBe(0);
    });

    test('PUT Group with members → members updated in MongoDB', async () => {
        const request = getSharedRequest();

        // Create
        const createResponse = await request
            .post('/4_0_0/Group')
            .send({
                resourceType: 'Group',
                type: 'person',
                actual: true,
                name: 'Update Test Group',
                member: [{ entity: { reference: 'Patient/original-member' } }],
                meta: defaultMeta
            })
            .set(getTestHeaders());

        expect(createResponse.status).toBe(201);
        const groupId = createResponse.body.id;

        // Update with different members
        const updateResponse = await request
            .put(`/4_0_0/Group/${groupId}`)
            .send({
                resourceType: 'Group',
                id: groupId,
                type: 'person',
                actual: true,
                name: 'Update Test Group',
                member: [
                    { entity: { reference: 'Patient/updated-member-1' } },
                    { entity: { reference: 'Patient/updated-member-2' } },
                    { entity: { reference: 'Patient/updated-member-3' } }
                ],
                meta: defaultMeta
            })
            .set(getTestHeaders());

        expect(updateResponse.status).toBe(200);

        // GET should return updated members
        const getResponse = await request.get(`/4_0_0/Group/${groupId}`).set(getTestHeaders());

        expect(getResponse.status).toBe(200);
        expect(getResponse.body.member).toHaveLength(3);
    });

    test('PATCH Group members → standard JSON Patch applied to MongoDB', async () => {
        const request = getSharedRequest();
        const { getHeadersJsonPatch } = require('../common');

        // Create Group with 1 member
        const createResponse = await request
            .post('/4_0_0/Group')
            .send({
                resourceType: 'Group',
                type: 'person',
                actual: true,
                name: 'Patch Test Group',
                member: [{ entity: { reference: 'Patient/existing-member' } }],
                meta: defaultMeta
            })
            .set(getTestHeaders());

        expect(createResponse.status).toBe(201);
        const groupId = createResponse.body.id;

        // Standard JSON Patch to add a member (standard FHIR, no ClickHouse header)
        const patchResponse = await request
            .patch(`/4_0_0/Group/${groupId}`)
            .send([
                {
                    op: 'add',
                    path: '/member/-',
                    value: { entity: { reference: 'Patient/patch-added-member' } }
                }
            ])
            .set(getHeadersJsonPatch());

        expect(patchResponse.status).toBe(200);

        // GET should show both members
        const getResponse = await request.get(`/4_0_0/Group/${groupId}`).set(getTestHeaders());

        expect(getResponse.status).toBe(200);
        expect(getResponse.body.member).toHaveLength(2);
    });

    test('Group without members → standard empty Group', async () => {
        const request = getSharedRequest();

        const createResponse = await request
            .post('/4_0_0/Group')
            .send({
                resourceType: 'Group',
                type: 'person',
                actual: true,
                name: 'Empty Group',
                meta: defaultMeta
            })
            .set(getTestHeaders());

        expect(createResponse.status).toBe(201);
        const groupId = createResponse.body.id;

        // GET should return Group without member array
        const getResponse = await request.get(`/4_0_0/Group/${groupId}`).set(getTestHeaders());

        expect(getResponse.status).toBe(200);
        expect(getResponse.body.name).toBe('Empty Group');
        // member should not be present or be undefined
        expect(getResponse.body.member || []).toHaveLength(0);
    });
});
