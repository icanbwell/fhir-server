const { describe, test, beforeAll, beforeEach, afterAll, expect } = require('@jest/globals');
const {
    setupGroupTests,
    teardownGroupTests,
    cleanupAllData,
    getSharedRequest,
    getTestHeadersWithExternalStorage,
    waitForData
} = require('./groupTestSetup');

describe('Group Pagination with ClickHouse', () => {
    // Test data sizes
    const TEST_DATA_SIZES = {
        LARGE: 50,
        MEDIUM: 30,
        SMALL: 5,
        SINGLE: 1
    };

    // Page sizes for pagination tests
    const PAGE_SIZES = {
        LARGE: 10,
        MEDIUM: 10,
        SINGLE: 1
    };

    // Timeouts for polling operations (increased for ClickHouse materialized view lag)
    const TIMEOUTS = {
        LARGE_SET: 30000,  // 30 seconds for 50 groups
        MEDIUM_SET: 20000, // 20 seconds for 30 groups
        SMALL_SET: 15000   // 15 seconds for small sets
    };

    beforeAll(async () => {
        await setupGroupTests();
    });

    beforeEach(async () => {
        await cleanupAllData();
    });

    afterAll(async () => {
        await teardownGroupTests();
    });

    async function createGroup({ id, members = [] }) {
        const request = getSharedRequest();
        const group = {
            resourceType: 'Group',
            id,
            meta: {
                source: 'http://pagination-test.com/Group',
                security: [
                    { system: 'https://www.icanbwell.com/owner', code: 'pagination-test' },
                    { system: 'https://www.icanbwell.com/access', code: 'pagination-test' }
                ]
            },
            type: 'person',
            actual: true,
            name: `Pagination Test Group ${id}`,
            member: members
        };

        const response = await request
            .post('/4_0_0/Group')
            .send(group)
            .set(getTestHeadersWithExternalStorage());

        expect(response.status).toBe(201);
        return response.body;
    }

    test('Multi-page navigation through large result set', async () => {
        const memberRef = `Patient/pagination-test-${Date.now()}`;
        const groupIds = [];

        for (let i = 0; i < TEST_DATA_SIZES.LARGE; i++) {
            const created = await createGroup({
                members: [{ entity: { reference: memberRef } }]
            });
            groupIds.push(created.id);
        }

        // Wait for ClickHouse sync with smart polling (FINAL modifier ensures immediate consistency)
        const request = getSharedRequest();
        await waitForData(
            async () => {
                const testResponse = await request
                    .get(`/4_0_0/Group?member=${encodeURIComponent(memberRef)}&_count=1`)
                    .set(getTestHeadersWithExternalStorage());
                return testResponse.status === 200 && testResponse.body.entry && testResponse.body.entry.length >= 1;
            },
            { timeout: TIMEOUTS.LARGE_SET, description: 'Groups to be indexed' }
        );

        // Page through all results
        const allRetrievedIds = [];
        let nextPath = `/4_0_0/Group?member=${encodeURIComponent(memberRef)}&_count=${PAGE_SIZES.LARGE}`;
        let pageCount = 0;
        const maxPages = TEST_DATA_SIZES.LARGE / PAGE_SIZES.LARGE; // Safety limit

        while (nextPath && pageCount < maxPages) {
            const response = await request
                .get(nextPath)
                .set(getTestHeadersWithExternalStorage());

            expect(response.status).toBe(200);
            expect(response.body.resourceType).toBe('Bundle');

            // Collect IDs from this page
            if (response.body.entry) {
                const pageIds = response.body.entry.map(e => e.resource.id);
                allRetrievedIds.push(...pageIds);
            }

            // Find next link and extract path
            const nextLink = response.body.link?.find(l => l.relation === 'next');
            console.log('[PAGE', pageCount + 1, '] Retrieved', response.body.entry?.length || 0, 'Groups. Next link:', nextLink?.url || 'none');
            if (nextLink && nextLink.url) {
                // Extract path from URL (handle both relative and absolute URLs)
                try {
                    const url = new URL(nextLink.url, 'http://localhost');
                    nextPath = url.pathname + url.search;
                } catch (e) {
                    // If already a relative path, use as-is
                    nextPath = nextLink.url;
                }
            } else {
                nextPath = null;
            }
            pageCount++;
        }

        // Verify we got all Groups
        expect(allRetrievedIds.length).toBe(TEST_DATA_SIZES.LARGE);

        // Verify no duplicates
        const uniqueIds = new Set(allRetrievedIds);
        expect(uniqueIds.size).toBe(TEST_DATA_SIZES.LARGE);

        // Verify all created Groups were retrieved
        for (const groupId of groupIds) {
            expect(allRetrievedIds).toContain(groupId);
        }
    }, 120000); // 2 minute timeout

    test('_getpagesoffset parameter skips to correct offset', async () => {
        const memberRef = `Patient/offset-test-${Date.now()}`;
        const groupIds = [];

        for (let i = 0; i < TEST_DATA_SIZES.MEDIUM; i++) {
            const created = await createGroup({
                members: [{ entity: { reference: memberRef } }]
            });
            groupIds.push(created.id);
        }

        // Wait for ClickHouse sync with smart polling (FINAL modifier ensures immediate consistency)
        const request = getSharedRequest();
        await waitForData(
            async () => {
                const testResponse = await request
                    .get(`/4_0_0/Group?member=${encodeURIComponent(memberRef)}&_count=1`)
                    .set(getTestHeadersWithExternalStorage());
                return testResponse.status === 200 && testResponse.body.entry && testResponse.body.entry.length >= 1;
            },
            { timeout: TIMEOUTS.MEDIUM_SET, description: 'Groups to be indexed' }
        );

        // Get all results to establish order
        const allResponse = await request
            .get(`/4_0_0/Group?member=${encodeURIComponent(memberRef)}&_count=${TEST_DATA_SIZES.MEDIUM}`)
            .set(getTestHeadersWithExternalStorage());

        expect(allResponse.status).toBe(200);
        expect(allResponse.body.entry).toBeDefined();
        expect(allResponse.body.entry.length).toBeGreaterThanOrEqual(TEST_DATA_SIZES.MEDIUM);

        const allIdsInOrder = allResponse.body.entry.map(e => e.resource.id);

        // `_getpagesoffset` on this server is a PAGE NUMBER, not a row offset:
        // searchManager.handleCountOption sets skip = pageNumber * _count (same semantics
        // the AuditEvent ClickHouse search tests rely on). With MEDIUM (30) total and
        // _count=10 there are 3 pages (0,1,2). We fetch page 1 and assert it is EXACTLY
        // the middle slice allIdsInOrder[10..19]. A broken/ignored offset (silent no-op
        // returning nothing, or returning page 0 again) must FAIL here, not be skipped.
        const pageSize = PAGE_SIZES.LARGE; // 10
        const page1Response = await request
            .get(`/4_0_0/Group?member=${encodeURIComponent(memberRef)}&_count=${pageSize}&_getpagesoffset=1`)
            .set(getTestHeadersWithExternalStorage());

        expect(page1Response.status).toBe(200);

        // Page 1 must be present and exactly _count long (30 total, second page).
        expect(Array.isArray(page1Response.body.entry)).toBe(true);
        expect(page1Response.body.entry.length).toBe(pageSize);

        const page1Ids = page1Response.body.entry.map(e => e.resource.id);

        // Page 1 must be the exact second-page slice (fixed indices, not sized by the
        // response - so a wrong-length or wrong-window result cannot self-satisfy).
        const expectedPage1Ids = allIdsInOrder.slice(pageSize, pageSize * 2);
        expect(page1Ids).toEqual(expectedPage1Ids);

        // Guard against a no-op offset that silently returns the first page instead.
        const firstPageIds = allIdsInOrder.slice(0, pageSize);
        expect(page1Ids).not.toEqual(firstPageIds);

        // Cross-check: pages 0 + 1 + 2 reconstruct the full, distinct result set, proving
        // the offset actually advances the window rather than returning a fixed page.
        const page0Response = await request
            .get(`/4_0_0/Group?member=${encodeURIComponent(memberRef)}&_count=${pageSize}&_getpagesoffset=0`)
            .set(getTestHeadersWithExternalStorage());
        const page2Response = await request
            .get(`/4_0_0/Group?member=${encodeURIComponent(memberRef)}&_count=${pageSize}&_getpagesoffset=2`)
            .set(getTestHeadersWithExternalStorage());

        expect(page0Response.status).toBe(200);
        expect(page2Response.status).toBe(200);

        const page0Ids = (page0Response.body.entry || []).map(e => e.resource.id);
        const page2Ids = (page2Response.body.entry || []).map(e => e.resource.id);

        const combined = [...page0Ids, ...page1Ids, ...page2Ids];
        expect(combined).toHaveLength(TEST_DATA_SIZES.MEDIUM);
        expect(new Set(combined).size).toBe(TEST_DATA_SIZES.MEDIUM);
        expect(combined).toEqual(allIdsInOrder.slice(0, TEST_DATA_SIZES.MEDIUM));
    }, 60000);

    test('Pagination beyond available results returns empty', async () => {
        const memberRef = `Patient/beyond-test-${Date.now()}`;

        // Create single Group
        await createGroup({
            members: [{ entity: { reference: memberRef } }]
        });

        const request = getSharedRequest();

        // Wait for ClickHouse sync with smart polling (FINAL modifier ensures immediate consistency)
        await waitForData(
            async () => {
                const testResponse = await request
                    .get(`/4_0_0/Group?member=${encodeURIComponent(memberRef)}&_count=1`)
                    .set(getTestHeadersWithExternalStorage());
                return testResponse.status === 200 && testResponse.body.entry && testResponse.body.entry.length >= 1;
            },
            { timeout: TIMEOUTS.SMALL_SET, description: 'Group to be indexed' }
        );

        // Query with offset beyond available results
        const response = await request
            .get(`/4_0_0/Group?member=${encodeURIComponent(memberRef)}&_count=10&_getpagesoffset=100`)
            .set(getTestHeadersWithExternalStorage());

        expect(response.status).toBe(200);
        expect(response.body.resourceType).toBe('Bundle');

        // Should return empty entry array (or no entry field)
        const entries = response.body.entry || [];
        expect(entries).toHaveLength(0);
    }, 30000);

    test('Pagination with _count=1 returns single result', async () => {
        const memberRef = `Patient/single-page-test-${Date.now()}`;

        for (let i = 0; i < TEST_DATA_SIZES.SMALL; i++) {
            await createGroup({
                members: [{ entity: { reference: memberRef } }]
            });
        }

        const request = getSharedRequest();

        // Wait for ClickHouse sync with smart polling (FINAL modifier ensures immediate consistency)
        await waitForData(
            async () => {
                const testResponse = await request
                    .get(`/4_0_0/Group?member=${encodeURIComponent(memberRef)}&_count=1`)
                    .set(getTestHeadersWithExternalStorage());
                return testResponse.status === 200 && testResponse.body.entry && testResponse.body.entry.length >= 1;
            },
            { timeout: TIMEOUTS.SMALL_SET, description: 'Group to be indexed' }
        );

        // Query with _count=1
        const response = await request
            .get(`/4_0_0/Group?member=${encodeURIComponent(memberRef)}&_count=1`)
            .set(getTestHeadersWithExternalStorage());

        expect(response.status).toBe(200);
        expect(response.body.entry).toBeDefined();
        expect(response.body.entry.length).toBe(1);

        // Verify next link exists since there are more results
        const nextLink = response.body.link?.find(l => l.relation === 'next');
        expect(nextLink).toBeDefined();
    }, 30000);
});
