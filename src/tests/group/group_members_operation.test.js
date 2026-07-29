// Test for Group $members operation
// Validates that $members operation returns paginated members from ClickHouse

const { describe, test, beforeAll, afterAll, beforeEach, expect } = require('@jest/globals');
const {
    setupGroupTests,
    teardownGroupTests,
    cleanupAllData,
    getSharedRequest,
    getTestHeadersWithExternalStorage,
    syncClickHouseMaterializedViews,
    waitForData
} = require('./groupTestSetup');

describe('Group $members operation', () => {
    beforeAll(async () => {
        await setupGroupTests();
    });

    afterAll(async () => {
        await teardownGroupTests();
    });

    beforeEach(async () => {
        await cleanupAllData();
    });

    const defaultMeta = {
        source: 'http://test-system.com/Group|test-owner',
        security: [
            { system: 'https://www.icanbwell.com/owner', code: 'test-owner' },
            { system: 'https://www.icanbwell.com/access', code: 'test-access' }
        ]
    };

    test('returns paginated members from ClickHouse', async () => {
        const request = getSharedRequest();

        // Create Group with multiple members
        const groupResource = {
            resourceType: 'Group',
            id: 'test-group-members',
            type: 'person',
            actual: true,
            member: [
                { entity: { reference: 'Patient/patient-1' } },
                { entity: { reference: 'Patient/patient-2' } },
                { entity: { reference: 'Patient/patient-3' } }
            ],
            meta: defaultMeta
        };

        let createResp = await request
            .post('/4_0_0/Group')
            .send(groupResource)
            .set(getTestHeadersWithExternalStorage())
            .expect(201);

        // Capture the generated UUID (POST ignores the id in the body)
        const groupId = createResp.body.id;

        // Wait for ClickHouse data
        await syncClickHouseMaterializedViews();
        await waitForData(
            async () => {
                const resp = await request
                    .get('/4_0_0/Group?member=Patient/patient-1')
                    .set(getTestHeadersWithExternalStorage());
                return resp.body?.entry?.length >= 1;
            },
            { description: 'group with members to be available' }
        );

        // Call $members operation with the generated UUID
        const resp = await request
            .get(`/4_0_0/Group/${groupId}/$members`)
            .set(getTestHeadersWithExternalStorage())
            .expect(200);

        const bundle = resp.body;
        expect(bundle.resourceType).toBe('Bundle');
        expect(bundle.type).toBe('searchset');
        expect(bundle.total).toBe(3);
        expect(bundle.entry).toHaveLength(3);

        // Verify member references
        const references = bundle.entry.map(e => e.resource.entity.reference).sort();
        expect(references).toEqual(['Patient/patient-1', 'Patient/patient-2', 'Patient/patient-3']);

        // Verify pagination links
        expect(bundle.link).toBeDefined();
        expect(bundle.link.find(l => l.relation === 'self')).toBeDefined();
    });

    test('supports pagination with _count parameter', async () => {
        const request = getSharedRequest();

        // Create Group with many members
        const members = Array.from({ length: 10 }, (_, i) => ({
            entity: { reference: `Patient/patient-${i}` }
        }));

        const groupResource = {
            resourceType: 'Group',
            id: 'test-group-pagination',
            type: 'person',
            actual: true,
            member: members,
            meta: defaultMeta
        };

        let createResp = await request
            .post('/4_0_0/Group')
            .send(groupResource)
            .set(getTestHeadersWithExternalStorage())
            .expect(201);

        // Capture the generated UUID
        const groupId = createResp.body.id;

        // Wait for ClickHouse data
        await syncClickHouseMaterializedViews();
        await waitForData(
            async () => {
                const resp = await request
                    .get('/4_0_0/Group?member=Patient/patient-0')
                    .set(getTestHeadersWithExternalStorage());
                return resp.body?.entry?.length >= 1;
            },
            { description: 'group with members to be available' }
        );

        // Get first page with _count=3
        const resp = await request
            .get(`/4_0_0/Group/${groupId}/$members?_count=3`)
            .set(getTestHeadersWithExternalStorage())
            .expect(200);

        const bundle = resp.body;
        expect(bundle.resourceType).toBe('Bundle');
        expect(bundle.total).toBe(10);
        expect(bundle.entry).toHaveLength(3);

        // Should have next link since there are more results
        const nextLink = bundle.link.find(l => l.relation === 'next');
        expect(nextLink).toBeDefined();
        expect(nextLink.url).toContain('_cursor=');
    });

    test('supports cursor-based pagination with _cursor parameter', async () => {
        const request = getSharedRequest();

        // Create Group with members
        const members = Array.from({ length: 5 }, (_, i) => ({
            entity: { reference: `Patient/patient-${i}` }
        }));

        const groupResource = {
            resourceType: 'Group',
            id: 'test-group-cursor',
            type: 'person',
            actual: true,
            member: members,
            meta: defaultMeta
        };

        let createResp = await request
            .post('/4_0_0/Group')
            .send(groupResource)
            .set(getTestHeadersWithExternalStorage())
            .expect(201);

        // Capture the generated UUID
        const groupId = createResp.body.id;

        // Wait for ClickHouse data
        await syncClickHouseMaterializedViews();
        await waitForData(
            async () => {
                const resp = await request
                    .get('/4_0_0/Group?member=Patient/patient-0')
                    .set(getTestHeadersWithExternalStorage());
                return resp.body?.entry?.length >= 1;
            },
            { description: 'group with members to be available' }
        );

        // Get first page
        const firstPage = await request
            .get(`/4_0_0/Group/${groupId}/$members?_count=2`)
            .set(getTestHeadersWithExternalStorage())
            .expect(200);

        expect(firstPage.body.entry).toHaveLength(2);

        // Extract cursor from next link
        const nextLink = firstPage.body.link.find(l => l.relation === 'next');
        expect(nextLink).toBeDefined();

        const cursorMatch = nextLink.url.match(/_cursor=([^&]+)/);
        expect(cursorMatch).toBeTruthy();
        const cursor = decodeURIComponent(cursorMatch[1]);

        // Get second page using cursor
        const secondPage = await request
            .get(`/4_0_0/Group/${groupId}/$members?_count=2&_cursor=${encodeURIComponent(cursor)}`)
            .set(getTestHeadersWithExternalStorage())
            .expect(200);

        expect(secondPage.body.entry).toHaveLength(2);

        // Verify no duplicate members between pages
        const firstPageRefs = firstPage.body.entry.map(e => e.resource.entity.reference);
        const secondPageRefs = secondPage.body.entry.map(e => e.resource.entity.reference);
        const intersection = firstPageRefs.filter(ref => secondPageRefs.includes(ref));
        expect(intersection).toHaveLength(0);
    });

    test('returns error when useExternalStorage header is not set', async () => {
        const request = getSharedRequest();

        const resp = await request
            .get('/4_0_0/Group/test-group/$members')
            .set({ Authorization: getTestHeadersWithExternalStorage().Authorization })
            .expect(200);

        const outcome = resp.body;
        expect(outcome.resourceType).toBe('OperationOutcome');
        expect(outcome.issue[0].severity).toBe('error');
        expect(outcome.issue[0].diagnostics).toContain('useExternalStorage');
    });

    test('returns empty result for group with no members', async () => {
        const request = getSharedRequest();

        // Create empty Group
        const groupResource = {
            resourceType: 'Group',
            id: 'empty-group',
            type: 'person',
            actual: true,
            member: [],
            meta: defaultMeta
        };

        let createResp = await request
            .post('/4_0_0/Group')
            .send(groupResource)
            .set(getTestHeadersWithExternalStorage())
            .expect(201);

        // Capture the generated UUID
        const groupId = createResp.body.id;

        await syncClickHouseMaterializedViews();

        // Call $members operation
        const resp = await request
            .get(`/4_0_0/Group/${groupId}/$members`)
            .set(getTestHeadersWithExternalStorage())
            .expect(200);

        const bundle = resp.body;
        expect(bundle.resourceType).toBe('Bundle');
        expect(bundle.total).toBe(0);
        expect(bundle.entry).toBeUndefined();
    });

    test('validates _count parameter limits', async () => {
        const request = getSharedRequest();

        // Create Group
        const groupResource = {
            resourceType: 'Group',
            id: 'test-group-limits',
            type: 'person',
            actual: true,
            member: [{ entity: { reference: 'Patient/test' } }],
            meta: defaultMeta
        };

        let createResp = await request
            .post('/4_0_0/Group')
            .send(groupResource)
            .set(getTestHeadersWithExternalStorage())
            .expect(201);

        // Capture the generated UUID
        const groupId = createResp.body.id;

        await syncClickHouseMaterializedViews();
        await waitForData(
            async () => {
                const resp = await request
                    .get('/4_0_0/Group?member=Patient/test')
                    .set(getTestHeadersWithExternalStorage());
                return resp.body?.entry?.length >= 1;
            },
            { description: 'group with member to be available' }
        );

        // Test with count > max (should cap at 1000)
        const resp = await request
            .get(`/4_0_0/Group/${groupId}/$members?_count=2000`)
            .set(getTestHeadersWithExternalStorage())
            .expect(200);

        expect(resp.body.resourceType).toBe('Bundle');
        // Should still return results, just capped
    });

    test('returns only active members (not removed)', async () => {
        const request = getSharedRequest();

        // Create Group with members
        const groupResource = {
            resourceType: 'Group',
            id: 'test-group-active',
            type: 'person',
            actual: true,
            member: [
                { entity: { reference: 'Patient/patient-1' } },
                { entity: { reference: 'Patient/patient-2' } }
            ],
            meta: defaultMeta
        };

        let createResp = await request
            .post('/4_0_0/Group')
            .send(groupResource)
            .set(getTestHeadersWithExternalStorage())
            .expect(201);

        // Capture the generated UUID
        const groupId = createResp.body.id;

        await syncClickHouseMaterializedViews();
        await waitForData(
            async () => {
                const resp = await request
                    .get('/4_0_0/Group?member=Patient/patient-1')
                    .set(getTestHeadersWithExternalStorage());
                return resp.body?.entry?.length >= 1;
            },
            { description: 'group with members to be available' }
        );

        // Remove one member - must use PUT with the same ID to update
        const updatedGroup = {
            resourceType: 'Group',
            id: groupId,
            type: 'person',
            actual: true,
            member: [
                { entity: { reference: 'Patient/patient-1' } }
            ],
            meta: defaultMeta
        };

        await request
            .put(`/4_0_0/Group/${groupId}`)
            .send(updatedGroup)
            .set(getTestHeadersWithExternalStorage())
            .expect(200);

        await syncClickHouseMaterializedViews();
        await waitForData(
            async () => {
                const resp = await request
                    .get('/4_0_0/Group?member=Patient/patient-1')
                    .set(getTestHeadersWithExternalStorage());
                return resp.body?.entry?.length === 1;
            },
            { description: 'updated group to be available' }
        );

        // $members should only return active member
        const resp = await request
            .get(`/4_0_0/Group/${groupId}/$members`)
            .set(getTestHeadersWithExternalStorage())
            .expect(200);

        const bundle = resp.body;
        expect(bundle.total).toBe(1);
        expect(bundle.entry).toHaveLength(1);
        expect(bundle.entry[0].resource.entity.reference).toBe('Patient/patient-1');
    });
});
