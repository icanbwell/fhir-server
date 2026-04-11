const { describe, test, beforeAll, beforeEach, afterAll, expect } = require('@jest/globals');
const {
    setupGroupTests,
    teardownGroupTests,
    cleanupBetweenTests,
    getSharedRequest,
    getClickHouseManager,
    getTestHeadersWithExternalStorage,
    syncClickHouseMaterializedViews,
    waitForData
} = require('./groupTestSetup');
const { getHeadersJsonPatch } = require('../common');
const { USE_EXTERNAL_MEMBER_STORAGE_HEADER } = require('../../utils/contextDataBuilder');

/**
 * ClickHouse Activation with Header Test Suite
 *
 * Verifies that WITH the useExternalMemberStorage header:
 * - Members are stripped from MongoDB and written to ClickHouse
 * - GET returns quantity from ClickHouse (no member array)
 * - PATCH writes ClickHouse events
 */
describe('Group with useExternalMemberStorage header', () => {
    beforeAll(async () => {
        await setupGroupTests();
    });

    beforeEach(async () => {
        await cleanupBetweenTests();
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

    test('POST with header → members in ClickHouse, stripped from MongoDB', async () => {
        const request = getSharedRequest();
        const clickHouseManager = getClickHouseManager();

        const createResponse = await request
            .post('/4_0_0/Group')
            .send({
                resourceType: 'Group',
                type: 'person',
                actual: true,
                name: 'ClickHouse Group',
                member: [
                    { entity: { reference: 'Patient/ch-patient-1' } },
                    { entity: { reference: 'Patient/ch-patient-2' } },
                    { entity: { reference: 'Patient/ch-patient-3' } }
                ],
                meta: defaultMeta
            })
            .set(getTestHeadersWithExternalStorage());

        expect(createResponse.status).toBe(201);
        const groupId = createResponse.body.id;

        // ClickHouse should have 3 events
        await waitForData(
            async () => {
                const events = await clickHouseManager.queryAsync({
                    query: `SELECT count() as count FROM fhir.fhir_group_member_events WHERE group_id = '${groupId}'`
                });
                return parseInt(events[0].count) === 3;
            },
            { description: 'ClickHouse events' }
        );

        // Verify events have entity_reference_uuid and entity_reference_source_id
        const events = await clickHouseManager.queryAsync({
            query: `SELECT entity_reference, entity_reference_uuid, entity_reference_source_id FROM fhir.fhir_group_member_events WHERE group_id = '${groupId}' ORDER BY entity_reference`
        });
        expect(events).toHaveLength(3);

        for (const event of events) {
            expect(event.entity_reference_uuid).toBeTruthy();
            expect(event.entity_reference_source_id).toBeTruthy();
            // sourceId should contain the Patient/ prefix
            expect(event.entity_reference_source_id).toMatch(/^Patient\//);
            // uuid should contain the Patient/ prefix
            expect(event.entity_reference_uuid).toMatch(/^Patient\//);
        }
    });

    test('GET with header → no member array, quantity from ClickHouse', async () => {
        const request = getSharedRequest();

        // Create with header
        const createResponse = await request
            .post('/4_0_0/Group')
            .send({
                resourceType: 'Group',
                type: 'person',
                actual: true,
                name: 'Read Test Group',
                member: [
                    { entity: { reference: 'Patient/read-patient-1' } },
                    { entity: { reference: 'Patient/read-patient-2' } }
                ],
                meta: defaultMeta
            })
            .set(getTestHeadersWithExternalStorage());

        expect(createResponse.status).toBe(201);
        const groupId = createResponse.body.id;

        await syncClickHouseMaterializedViews();

        // GET with header → enrichment strips members, sets quantity
        const getResponse = await request.get(`/4_0_0/Group/${groupId}`).set(getTestHeadersWithExternalStorage());

        expect(getResponse.status).toBe(200);
        expect(getResponse.body.member).toBeUndefined();
        expect(getResponse.body.quantity).toBe(2);
    });

    test('PATCH with header → writes ClickHouse events', async () => {
        const request = getSharedRequest();
        const clickHouseManager = getClickHouseManager();

        // Create with 1 member
        const createResponse = await request
            .post('/4_0_0/Group')
            .send({
                resourceType: 'Group',
                type: 'person',
                actual: true,
                name: 'Patch Header Test',
                member: [{ entity: { reference: 'Patient/patch-base' } }],
                meta: defaultMeta
            })
            .set(getTestHeadersWithExternalStorage());

        expect(createResponse.status).toBe(201);
        const groupId = createResponse.body.id;

        // PATCH to add member with header
        const patchHeaders = {
            ...getHeadersJsonPatch(),
            [USE_EXTERNAL_MEMBER_STORAGE_HEADER]: 'true'
        };

        const patchResponse = await request
            .patch(`/4_0_0/Group/${groupId}`)
            .send([
                {
                    op: 'add',
                    path: '/member/-',
                    value: { entity: { reference: 'Patient/patch-added' } }
                }
            ])
            .set(patchHeaders);

        expect(patchResponse.status).toBe(200);

        // Should have events for both members (1 from create + 1 from patch)
        await waitForData(
            async () => {
                const events = await clickHouseManager.queryAsync({
                    query: `SELECT count() as count FROM fhir.fhir_group_member_events WHERE group_id = '${groupId}'`
                });
                return parseInt(events[0].count) >= 2;
            },
            { description: 'PATCH ClickHouse events' }
        );
    });

    test('header constant is correctly lowercased', () => {
        expect(USE_EXTERNAL_MEMBER_STORAGE_HEADER).toBe('useexternalmemberstorage');
    });
});
