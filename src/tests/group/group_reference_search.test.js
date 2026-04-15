const { describe, test, beforeAll, beforeEach, afterAll, expect } = require('@jest/globals');
const {
    setupGroupTests,
    teardownGroupTests,
    cleanupAllData,
    getSharedRequest,
    getClickHouseManager,
    getTestHeadersWithExternalStorage,
    syncClickHouseMaterializedViews,
    waitForData
} = require('./groupTestSetup');
const { generateUUIDv5 } = require('../../utils/uid.util');

/**
 * Reference Search Test Suite
 *
 * Verifies that member search works via _uuid and _sourceId columns.
 *
 * The FHIR search pipeline resolves references before they reach ClickHouse:
 * - Patient/123|client → ReferenceQueryRewriter computes uuidv5("123|client")
 *   → query uses member.entity._uuid → ClickHouse entity_reference_uuid
 * - Patient/<uuid> → already UUID → same path
 * - Patient/123 (no owner) → not rewritten → query uses member.entity._sourceId
 *   → ClickHouse entity_reference_source_id
 */
describe('Group member reference search via ClickHouse', () => {
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
        source: 'http://test-system.com/Group|test-owner',
        security: [
            { system: 'https://www.icanbwell.com/owner', code: 'test-owner' },
            { system: 'https://www.icanbwell.com/access', code: 'test-access' }
        ]
    };

    test('search by reference with sourceAssigningAuthority → uses entity_reference_uuid column', async () => {
        const request = getSharedRequest();
        const clickHouseManager = getClickHouseManager();

        // Create Group with member reference that has sourceAssigningAuthority
        // Patient/search-patient-1|test-owner will be resolved by ReferenceQueryRewriter
        // to Patient/<uuidv5("search-patient-1|test-owner")>
        const createResponse = await request
            .post('/4_0_0/Group')
            .send({
                resourceType: 'Group',
                type: 'person',
                actual: true,
                name: 'UUID Search Group',
                member: [{ entity: { reference: 'Patient/search-patient-1|test-owner' } }],
                meta: defaultMeta
            })
            .set(getTestHeadersWithExternalStorage());

        expect(createResponse.status).toBe(201);
        const groupId = createResponse.body.id;

        // Wait for ClickHouse events
        await waitForData(
            async () => {
                const events = await clickHouseManager.queryAsync({
                    query: `SELECT count() as count FROM fhir.Group_4_0_0_MemberEvents WHERE group_id = '${groupId}'`
                });
                return parseInt(events[0].count) === 1;
            },
            { description: 'ClickHouse events for UUID search test' }
        );

        await syncClickHouseMaterializedViews();

        // Verify the event has the correct uuid
        const events = await clickHouseManager.queryAsync({
            query: `SELECT entity_reference_uuid, entity_reference_source_id FROM fhir.Group_4_0_0_MemberEvents WHERE group_id = '${groupId}'`
        });
        expect(events).toHaveLength(1);

        const expectedUuid = generateUUIDv5('search-patient-1|test-owner');
        expect(events[0].entity_reference_uuid).toBe(`Patient/${expectedUuid}`);
        expect(events[0].entity_reference_source_id).toBe('Patient/search-patient-1');

        // Search using the same reference format → ReferenceQueryRewriter resolves to UUID
        const searchResponse = await request
            .get('/4_0_0/Group?member=Patient/search-patient-1|test-owner')
            .set(getTestHeadersWithExternalStorage());

        expect(searchResponse.status).toBe(200);
        const bundle = searchResponse.body;
        expect(bundle.resourceType).toBe('Bundle');
        expect(bundle.entry).toBeDefined();
        expect(bundle.entry.length).toBeGreaterThanOrEqual(1);

        const foundGroupIds = bundle.entry.map((e) => e.resource.id);
        expect(foundGroupIds).toContain(groupId);
    });

    test('search by plain reference (no owner) → uses entity_reference_source_id column', async () => {
        const request = getSharedRequest();
        const clickHouseManager = getClickHouseManager();

        // Create Group with member that has no sourceAssigningAuthority
        // Note: meta.source has |test-owner so the Group itself has an owner,
        // but the member reference 'Patient/plain-patient' has no | separator
        const createResponse = await request
            .post('/4_0_0/Group')
            .send({
                resourceType: 'Group',
                type: 'person',
                actual: true,
                name: 'SourceId Search Group',
                member: [{ entity: { reference: 'Patient/plain-patient' } }],
                meta: defaultMeta
            })
            .set(getTestHeadersWithExternalStorage());

        expect(createResponse.status).toBe(201);
        const groupId = createResponse.body.id;

        // Wait for ClickHouse events
        await waitForData(
            async () => {
                const events = await clickHouseManager.queryAsync({
                    query: `SELECT count() as count FROM fhir.Group_4_0_0_MemberEvents WHERE group_id = '${groupId}'`
                });
                return parseInt(events[0].count) === 1;
            },
            { description: 'ClickHouse events for sourceId search test' }
        );

        await syncClickHouseMaterializedViews();

        // Verify event has sourceId
        const events = await clickHouseManager.queryAsync({
            query: `SELECT entity_reference_source_id FROM fhir.Group_4_0_0_MemberEvents WHERE group_id = '${groupId}'`
        });
        expect(events[0].entity_reference_source_id).toMatch(/^Patient\//);
    });

    test('ClickHouse events store all three reference columns correctly', async () => {
        const request = getSharedRequest();
        const clickHouseManager = getClickHouseManager();

        const createResponse = await request
            .post('/4_0_0/Group')
            .send({
                resourceType: 'Group',
                type: 'person',
                actual: true,
                name: 'Three Column Test',
                member: [{ entity: { reference: 'Patient/col-test-1|test-owner' } }],
                meta: defaultMeta
            })
            .set(getTestHeadersWithExternalStorage());

        expect(createResponse.status).toBe(201);
        const groupId = createResponse.body.id;

        await waitForData(
            async () => {
                const events = await clickHouseManager.queryAsync({
                    query: `SELECT count() as count FROM fhir.Group_4_0_0_MemberEvents WHERE group_id = '${groupId}'`
                });
                return parseInt(events[0].count) === 1;
            },
            { description: 'ClickHouse events for column test' }
        );

        const events = await clickHouseManager.queryAsync({
            query: `SELECT entity_reference, entity_reference_uuid, entity_reference_source_id FROM fhir.Group_4_0_0_MemberEvents WHERE group_id = '${groupId}'`
        });

        expect(events).toHaveLength(1);
        const event = events[0];

        // entity_reference: raw reference from member.entity.reference
        expect(event.entity_reference).toContain('Patient/');

        // entity_reference_uuid: from member.entity._uuid (set by referenceGlobalIdHandler)
        expect(event.entity_reference_uuid).toMatch(/^Patient\//);
        const expectedUuid = generateUUIDv5('col-test-1|test-owner');
        expect(event.entity_reference_uuid).toBe(`Patient/${expectedUuid}`);

        // entity_reference_source_id: from member.entity._sourceId
        expect(event.entity_reference_source_id).toBe('Patient/col-test-1');
    });
});
