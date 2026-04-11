/**
 * Tests for MongoDB Group Member implementation
 *
 * Covers the complete lifecycle: write members to event collection,
 * read Group with quantity enrichment, search Groups by member reference.
 *
 * Parallel to ClickHouse Group tests but uses MongoDB-only member storage.
 */
process.env.ENABLE_MONGO_GROUP_MEMBERS = '1';
process.env.LOGLEVEL = 'SILENT';
process.env.STREAM_RESPONSE = '0';

const { describe, test, beforeAll, beforeEach, afterAll, expect } = require('@jest/globals');
const {
    setupMongoGroupTests,
    teardownMongoGroupTests,
    cleanupAllData,
    getSharedRequest,
    getTestHeaders
} = require('./mongoGroupMemberTestSetup');

describe('MongoDB Group Member Storage', () => {
    beforeAll(async () => {
        await setupMongoGroupTests();
    }, 60000);

    beforeEach(async () => {
        await cleanupAllData();
    });

    afterAll(async () => {
        await teardownMongoGroupTests();
    });

    // ========== Helper Functions ==========

    /**
     * Creates a Patient resource in MongoDB (needed for member reference validation)
     */
    async function createPatient(id) {
        const request = getSharedRequest();
        const patient = {
            resourceType: 'Patient',
            id,
            meta: {
                source: 'http://test-system.com/Patient',
                security: [
                    { system: 'https://www.icanbwell.com/owner', code: 'test-owner' },
                    { system: 'https://www.icanbwell.com/access', code: 'test-access' }
                ]
            },
            name: [{ family: `Test-${id}`, given: ['Patient'] }]
        };
        const response = await request
            .post('/4_0_0/Patient/$merge')
            .send(patient)
            .set(getTestHeaders());
        expect(response.status).toBe(200);
        return response.body;
    }

    /**
     * Creates a Group with members via POST
     */
    async function createGroup({ id, members = [], name = 'Test Group' }) {
        const request = getSharedRequest();
        const group = {
            resourceType: 'Group',
            id,
            meta: {
                source: 'http://test-system.com/Group',
                security: [
                    { system: 'https://www.icanbwell.com/owner', code: 'test-owner' },
                    { system: 'https://www.icanbwell.com/access', code: 'test-access' }
                ]
            },
            type: 'person',
            actual: true,
            name,
            member: members
        };

        const response = await request
            .post('/4_0_0/Group/$merge')
            .send(group)
            .set(getTestHeaders());

        expect(response.status).toBe(200);
        return response.body;
    }

    // ========== Write + Read Tests ==========

    describe('Write and Read', () => {
        test('POST Group with members stores them in event collection and strips from document', async () => {
            // Create patient resources that members reference
            await createPatient('patient-1');
            await createPatient('patient-2');

            // Create Group with members
            await createGroup({
                id: 'group-write-1',
                members: [
                    { entity: { reference: 'Patient/patient-1' } },
                    { entity: { reference: 'Patient/patient-2' } }
                ]
            });

            // GET the Group — member array should be stripped, quantity populated
            const request = getSharedRequest();
            const response = await request
                .get('/4_0_0/Group/group-write-1')
                .set(getTestHeaders());

            expect(response.status).toBe(200);
            expect(response.body.resourceType).toBe('Group');
            expect(response.body.id).toBe('group-write-1');
            expect(response.body.member).toBeUndefined();
            expect(response.body.quantity).toBe(2);
        }, 30000);

        test('POST Group without members returns quantity=0', async () => {
            await createGroup({
                id: 'group-empty',
                members: []
            });

            const request = getSharedRequest();
            const response = await request
                .get('/4_0_0/Group/group-empty')
                .set(getTestHeaders());

            expect(response.status).toBe(200);
            expect(response.body.quantity).toBe(0);
            expect(response.body.member).toBeUndefined();
        }, 30000);

        test('GET preserves other Group fields after enrichment', async () => {
            await createPatient('patient-fields-1');

            await createGroup({
                id: 'group-fields',
                name: 'Fields Test Group',
                members: [
                    { entity: { reference: 'Patient/patient-fields-1' } }
                ]
            });

            const request = getSharedRequest();
            const response = await request
                .get('/4_0_0/Group/group-fields')
                .set(getTestHeaders());

            expect(response.status).toBe(200);
            expect(response.body.type).toBe('person');
            expect(response.body.actual).toBe(true);
            expect(response.body.name).toBe('Fields Test Group');
            expect(response.body.meta).toBeDefined();
            expect(response.body.quantity).toBe(1);
            expect(response.body.member).toBeUndefined();
        }, 30000);
    });

    // ========== Search Tests ==========

    describe('Search by member', () => {
        test('GET /Group?member=Patient/X finds groups containing that member', async () => {
            // Create patients
            await createPatient('search-patient-1');
            await createPatient('search-patient-2');

            // Create two groups — one with patient-1, one with patient-2
            await createGroup({
                id: 'group-search-a',
                members: [{ entity: { reference: 'Patient/search-patient-1' } }]
            });
            await createGroup({
                id: 'group-search-b',
                members: [{ entity: { reference: 'Patient/search-patient-2' } }]
            });

            const request = getSharedRequest();

            // Search for groups containing patient-1
            const response = await request
                .get('/4_0_0/Group?member=Patient/search-patient-1')
                .set(getTestHeaders());

            expect(response.status).toBe(200);
            const entries = response.body.entry || [];
            const groupIds = entries.map(e => e.resource.id);

            expect(groupIds).toContain('group-search-a');
            expect(groupIds).not.toContain('group-search-b');
        }, 30000);

        test('GET /Group?member=Patient/X returns empty when no groups contain that member', async () => {
            await createPatient('search-patient-orphan');

            const request = getSharedRequest();
            const response = await request
                .get('/4_0_0/Group?member=Patient/search-patient-orphan')
                .set(getTestHeaders());

            expect(response.status).toBe(200);
            const entries = response.body.entry || [];
            expect(entries.length).toBe(0);
        }, 30000);

        test('Search returns correct quantity in results', async () => {
            await createPatient('search-qty-1');
            await createPatient('search-qty-2');
            await createPatient('search-qty-3');

            await createGroup({
                id: 'group-search-qty',
                members: [
                    { entity: { reference: 'Patient/search-qty-1' } },
                    { entity: { reference: 'Patient/search-qty-2' } },
                    { entity: { reference: 'Patient/search-qty-3' } }
                ]
            });

            const request = getSharedRequest();
            const response = await request
                .get('/4_0_0/Group?member=Patient/search-qty-1')
                .set(getTestHeaders());

            expect(response.status).toBe(200);
            const entries = response.body.entry || [];
            expect(entries.length).toBe(1);
            expect(entries[0].resource.quantity).toBe(3);
            expect(entries[0].resource.member).toBeUndefined();
        }, 30000);

        test('Member in multiple groups returns all groups', async () => {
            await createPatient('shared-patient');

            await createGroup({
                id: 'group-multi-1',
                members: [{ entity: { reference: 'Patient/shared-patient' } }]
            });
            await createGroup({
                id: 'group-multi-2',
                members: [{ entity: { reference: 'Patient/shared-patient' } }]
            });

            const request = getSharedRequest();
            const response = await request
                .get('/4_0_0/Group?member=Patient/shared-patient')
                .set(getTestHeaders());

            expect(response.status).toBe(200);
            const entries = response.body.entry || [];
            const groupIds = entries.map(e => e.resource.id);

            expect(groupIds).toContain('group-multi-1');
            expect(groupIds).toContain('group-multi-2');
        }, 30000);
    });

    // ========== UUID Search Tests ==========

    describe('Search by member UUID', () => {
        test('GET /Group?member=Patient/<uuid> finds groups via _uuid query path', async () => {
            // Use a UUID-format ID — triggers member.entity._uuid query path
            const uuid = '550e8400-e29b-41d4-a716-446655440000';
            await createPatient(uuid);

            await createGroup({
                id: 'group-uuid-search',
                members: [{ entity: { reference: `Patient/${uuid}` } }]
            });

            const request = getSharedRequest();
            const response = await request
                .get(`/4_0_0/Group?member=Patient/${uuid}`)
                .set(getTestHeaders());

            expect(response.status).toBe(200);
            const entries = response.body.entry || [];
            const groupIds = entries.map(e => e.resource.id);
            expect(groupIds).toContain('group-uuid-search');
        }, 30000);

        test('UUID search returns correct quantity', async () => {
            const uuid1 = '660e8400-e29b-41d4-a716-446655440001';
            const uuid2 = '660e8400-e29b-41d4-a716-446655440002';
            await createPatient(uuid1);
            await createPatient(uuid2);

            await createGroup({
                id: 'group-uuid-qty',
                members: [
                    { entity: { reference: `Patient/${uuid1}` } },
                    { entity: { reference: `Patient/${uuid2}` } }
                ]
            });

            const request = getSharedRequest();
            const response = await request
                .get(`/4_0_0/Group?member=Patient/${uuid1}`)
                .set(getTestHeaders());

            expect(response.status).toBe(200);
            const entries = response.body.entry || [];
            expect(entries.length).toBe(1);
            expect(entries[0].resource.quantity).toBe(2);
        }, 30000);
    });

    // ========== Update Tests ==========

    describe('Update (diff computation)', () => {
        test('PUT with changed members computes correct diff', async () => {
            await createPatient('diff-patient-1');
            await createPatient('diff-patient-2');
            await createPatient('diff-patient-3');

            // Create group with patient-1 and patient-2
            await createGroup({
                id: 'group-diff',
                members: [
                    { entity: { reference: 'Patient/diff-patient-1' } },
                    { entity: { reference: 'Patient/diff-patient-2' } }
                ]
            });

            // Update: remove patient-2, add patient-3
            await createGroup({
                id: 'group-diff',
                members: [
                    { entity: { reference: 'Patient/diff-patient-1' } },
                    { entity: { reference: 'Patient/diff-patient-3' } }
                ]
            });

            // Verify: should now have patient-1 and patient-3 (quantity=2)
            const request = getSharedRequest();
            const response = await request
                .get('/4_0_0/Group/group-diff')
                .set(getTestHeaders());

            expect(response.status).toBe(200);
            expect(response.body.quantity).toBe(2);

            // Verify via search: patient-2 should no longer be in the group
            const searchResponse = await request
                .get('/4_0_0/Group?member=Patient/diff-patient-2')
                .set(getTestHeaders());

            expect(searchResponse.status).toBe(200);
            const entries = searchResponse.body.entry || [];
            const groupIds = entries.map(e => e.resource.id);
            expect(groupIds).not.toContain('group-diff');

            // patient-3 should be in the group
            const search3Response = await request
                .get('/4_0_0/Group?member=Patient/diff-patient-3')
                .set(getTestHeaders());

            expect(search3Response.status).toBe(200);
            const entries3 = search3Response.body.entry || [];
            expect(entries3.map(e => e.resource.id)).toContain('group-diff');
        }, 30000);
    });

    // ========== Validation Tests ==========

    describe('Edge cases', () => {
        test('Group with no members still returns valid quantity=0', async () => {
            await createGroup({ id: 'group-edge-no-member', members: [] });

            const request = getSharedRequest();
            const response = await request
                .get('/4_0_0/Group/group-edge-no-member')
                .set(getTestHeaders());

            expect(response.status).toBe(200);
            expect(response.body.quantity).toBe(0);
            expect(response.body.member).toBeUndefined();
        }, 30000);
    });

    // ========== Non-member search tests ==========

    describe('Non-member searches (MongoDB metadata)', () => {
        test('GET /Group?type=person searches MongoDB metadata', async () => {
            await createGroup({
                id: 'group-meta-search',
                name: 'Metadata Search Group',
                members: []
            });

            const request = getSharedRequest();
            const response = await request
                .get('/4_0_0/Group?type=person')
                .set(getTestHeaders());

            expect(response.status).toBe(200);
            const entries = response.body.entry || [];
            const found = entries.some(e => e.resource.id === 'group-meta-search');
            expect(found).toBe(true);
        }, 30000);
    });
});
