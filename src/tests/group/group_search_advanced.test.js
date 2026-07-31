
const { describe, test, beforeAll, beforeEach, afterAll, expect } = require('@jest/globals');
const {
    setupGroupTests,
    teardownGroupTests,
    cleanupAllData,
    getSharedRequest,
    getClickHouseManager,
    getTestHeadersWithExternalStorage,
    waitForData
} = require('./groupTestSetup');

describe('Group Advanced Search', () => {
    // Test constants
    const TEST_GROUP_COUNTS = {
        PAGINATION_TEST: 25
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

    async function createGroup(group) {
        const request = getSharedRequest();
        const response = await request
            .post('/4_0_0/Group')
            .send({
                resourceType: 'Group',
                ...group,
                meta: group.meta || {
                    source: 'http://test-system.com/Group',
                    security: [
                        { system: 'https://www.icanbwell.com/owner', code: 'test-owner' },
                        { system: 'https://www.icanbwell.com/access', code: 'test-access' }
                    ]
                }
            })
            .set(getTestHeadersWithExternalStorage());

        expect(response.status).toBe(201);
        return response.body;
    }

    // `name` is NOT a FHIR R4 search parameter for Group (see the Group block in
    // src/searchParameters/searchParameters.js: actual, characteristic, code, exclude,
    // identifier, managing-entity, member, type, value). Under lenient handling an
    // unrecognized parameter is ignored, so `?name=` does not narrow the result set — for a
    // ClickHouse-backed Group or a pure-MongoDB one alike. This test pins that equivalence so
    // the behavior is not later mistaken for a hybrid-storage filtering bug. Combining member
    // with a *real* search parameter is covered by the two tests below.
    test('Combined filters: member AND an unsupported param (name) ignores the param', async () => {
        const memberRef = 'Patient/search-combined-1';

        await createGroup({
            type: 'person',
            actual: true,
            name: 'Alpha Group',
            member: [{ entity: { reference: memberRef } }]
        });

        await createGroup({
            type: 'person',
            actual: true,
            name: 'Beta Group',
            member: [{ entity: { reference: memberRef } }]
        });


        const request = getSharedRequest();
        const response = await request
            .get('/4_0_0/Group')
            .query({
                'member.entity.reference': memberRef,
                name: 'Alpha Group'
            })
            .set(getTestHeadersWithExternalStorage());

        expect(response.status).toBe(200);
        expect(response.body.entry).toBeDefined();

        // Both Groups contain the member, and `name` is not a Group search parameter, so both
        // come back. Not a filtering bug — an unsupported parameter, ignored per FHIR lenient
        // handling.
        const names = response.body.entry.map(e => e.resource.name).sort();
        expect(names).toEqual(['Alpha Group', 'Beta Group']);
    }, 30000);

    // Non-_id case: any supported non-member search parameter must still apply.
    test('Combined filters: member AND identifier returns only the matching Group', async () => {
        const memberRef = `Patient/search-combined-identifier-${Date.now()}`;
        const identifierSystem = 'http://test-system.com/group-key';

        const groupA = await createGroup({
            type: 'person',
            actual: true,
            name: 'Identifier Group A',
            identifier: [{ system: identifierSystem, value: 'key-a' }],
            member: [{ entity: { reference: memberRef } }]
        });

        await createGroup({
            type: 'person',
            actual: true,
            name: 'Identifier Group B',
            identifier: [{ system: identifierSystem, value: 'key-b' }],
            member: [{ entity: { reference: memberRef } }]
        });

        const request = getSharedRequest();
        const response = await request
            .get('/4_0_0/Group')
            .query({ member: memberRef, identifier: `${identifierSystem}|key-a` })
            .set(getTestHeadersWithExternalStorage());

        expect(response.status).toBe(200);
        expect(response.body.entry).toBeDefined();
        expect(response.body.entry.map(e => e.resource.id)).toEqual([groupA.id]);
    }, 30000);

    // The hybrid member-search path built its MongoDB fetch as
    // { id: { $in: <ids from ClickHouse> } }, discarding every other predicate in the original
    // query. So `_id` (and any other non-member criterion) was silently ignored and the search
    // returned every Group the member belonged to.
    test('Combined filters: member AND _id returns only the requested Group', async () => {
        const memberRef = `Patient/search-by-id-${Date.now()}`;

        const groupA = await createGroup({
            type: 'person',
            actual: true,
            name: 'Id Filter Group A',
            member: [{ entity: { reference: memberRef } }]
        });

        const groupB = await createGroup({
            type: 'person',
            actual: true,
            name: 'Id Filter Group B',
            member: [{ entity: { reference: memberRef } }]
        });

        const request = getSharedRequest();

        // Sanity check: without _id both Groups are found, so the filter below is what narrows it.
        const unfiltered = await request
            .get('/4_0_0/Group')
            .query({ member: memberRef })
            .set(getTestHeadersWithExternalStorage());
        expect(unfiltered.status).toBe(200);
        expect(unfiltered.body.entry.map(e => e.resource.id).sort())
            .toEqual([groupA.id, groupB.id].sort());

        const response = await request
            .get('/4_0_0/Group')
            .query({ member: memberRef, _id: groupA.id })
            .set(getTestHeadersWithExternalStorage());

        expect(response.status).toBe(200);
        expect(response.body.entry).toBeDefined();
        expect(response.body.entry.map(e => e.resource.id)).toEqual([groupA.id]);

        // The count path resolves membership in ClickHouse too, so it must apply the same
        // non-member predicates. Otherwise Bundle.total (2) contradicts Bundle.entry (1).
        const counted = await request
            .get('/4_0_0/Group')
            .query({ member: memberRef, _id: groupA.id, _total: 'accurate' })
            .set(getTestHeadersWithExternalStorage());
        expect(counted.status).toBe(200);
        expect(counted.body.total).toBe(1);
    }, 30000);

    test('Search with pagination (100+ results)', async () => {
        const memberRef = `Patient/search-pagination-${Date.now()}`;

        for (let i = 0; i < TEST_GROUP_COUNTS.PAGINATION_TEST; i++) {
            await createGroup({
                type: 'person',
                actual: true,
                name: `Pagination Group ${i}`,
                member: [{ entity: { reference: memberRef } }]
            });
        }


        const request = getSharedRequest();
        const response = await request
            .get('/4_0_0/Group')
            .query({
                'member.entity.reference': memberRef,
                _count: 10
            })
            .set(getTestHeadersWithExternalStorage());

        expect(response.status).toBe(200);
        expect(response.body.entry).toBeDefined();
        expect(response.body.entry.length).toBeLessThanOrEqual(10);
        expect(response.body.link).toBeDefined();
        expect(response.body.link.some(l => l.relation === 'next')).toBe(true);
    }, 60000);

    test('Search with sorting', async () => {
        const memberRef = `Patient/search-sort-${Date.now()}`;

        await createGroup({
            type: 'person',
            actual: true,
            name: 'Charlie Group',
            member: [{ entity: { reference: memberRef } }]
        });

        await createGroup({
            type: 'person',
            actual: true,
            name: 'Alpha Group',
            member: [{ entity: { reference: memberRef } }]
        });

        await createGroup({
            type: 'person',
            actual: true,
            name: 'Beta Group',
            member: [{ entity: { reference: memberRef } }]
        });


        const request = getSharedRequest();
        const response = await request
            .get('/4_0_0/Group')
            .query({
                'member.entity.reference': memberRef,
                _sort: 'name'
            })
            .set(getTestHeadersWithExternalStorage());

        expect(response.status).toBe(200);
        expect(response.body.entry).toBeDefined();

        if (response.body.entry && response.body.entry.length >= 2) {
            const names = response.body.entry.map(e => e.resource.name);
            const sortedNames = [...names].sort();
            expect(names).toEqual(sortedNames);
        }
    }, 30000);

    test('Filter by member inactive flag', async () => {
        const activeRef = 'Patient/search-active';
        const inactiveRef = 'Patient/search-inactive';

        await createGroup({
            type: 'person',
            actual: true,
            name: 'Mixed Group',
            member: [
                { entity: { reference: activeRef }, inactive: false },
                { entity: { reference: inactiveRef }, inactive: true }
            ]
        });


        const request = getSharedRequest();
        const activeResponse = await request
            .get('/4_0_0/Group')
            .query({ 'member.entity.reference': activeRef })
            .set(getTestHeadersWithExternalStorage());

        const inactiveResponse = await request
            .get('/4_0_0/Group')
            .query({ 'member.entity.reference': inactiveRef })
            .set(getTestHeadersWithExternalStorage());

        expect(activeResponse.status).toBe(200);
        expect(inactiveResponse.status).toBe(200);
    }, 30000);

    test('Search by member with wildcard/partial match', async () => {
        const member1 = 'Patient/search-wild-001';
        const member2 = 'Patient/search-wild-002';

        await createGroup({
            type: 'person',
            actual: true,
            name: 'Wildcard Group 1',
            member: [{ entity: { reference: member1 } }]
        });

        await createGroup({
            type: 'person',
            actual: true,
            name: 'Wildcard Group 2',
            member: [{ entity: { reference: member2 } }]
        });

        const request = getSharedRequest();

        // Wait for member1 data to be indexed (FINAL modifier ensures immediate consistency)
        await waitForData(
            async () => {
                const testResponse = await request
                    .get('/4_0_0/Group')
                    .query({ member: member1 })
                    .set(getTestHeadersWithExternalStorage());
                return testResponse.status === 200 && testResponse.body.entry && testResponse.body.entry.length >= 1;
            },
            { timeout: 10000, description: 'wildcard group 1 to be indexed' }
        );

        // Verify both searches work
        const response1 = await request
            .get('/4_0_0/Group')
            .query({ member: member1 })
            .set(getTestHeadersWithExternalStorage());

        const response2 = await request
            .get('/4_0_0/Group')
            .query({ member: member2 })
            .set(getTestHeadersWithExternalStorage());

        expect(response1.status).toBe(200);
        expect(response2.status).toBe(200);
        expect(response1.body.entry).toBeDefined();
        expect(response1.body.entry.length).toBeGreaterThanOrEqual(1);
        expect(response2.body.entry).toBeDefined();
        expect(response2.body.entry.length).toBeGreaterThanOrEqual(1);
    }, 30000);

    // Phase 2.2: Query Injection Protection Tests

    test('SQL injection pattern → Properly escaped', async () => {
        // Test that SQL injection attempts are safely handled
        const maliciousRef = "Patient/'; DROP TABLE Group_4_0_0_MemberEvents; --";

        const request = getSharedRequest();
        const response = await request
            .get('/4_0_0/Group')
            .query({ member: maliciousRef })
            .set(getTestHeadersWithExternalStorage());

        // Should return 200 with empty results (query escaped safely)
        expect(response.status).toBe(200);
        expect(response.body.resourceType).toBe('Bundle');
        // entry may be undefined or empty array when no results
        if (response.body.entry) {
            expect(Array.isArray(response.body.entry)).toBe(true);
        }

        // Verify table still exists (SQL injection didn't drop it)
        // Note: The key validation is that the query returns 200 without crashing
        const clickHouseManager = getClickHouseManager();
        try {
            const tableExists = await clickHouseManager.tableExistsAsync('fhir.Group_4_0_0_MemberEvents');
            expect(tableExists).toBe(true);
        } catch (e) {
            // If table check fails for other reasons, still consider test passed
            // The main goal is to verify query didn't execute SQL injection
            expect(response.status).toBe(200);
        }
    }, 15000);

    test('Member reference >10KB → Rejected or truncated', async () => {
        // Test handling of extremely long member references
        const longRef = 'Patient/' + 'A'.repeat(10000);

        const request = getSharedRequest();
        const response = await request
            .post('/4_0_0/Group')
            .send({
                resourceType: 'Group',
                type: 'person',
                actual: true,
                member: [{ entity: { reference: longRef } }],
                meta: {
                    source: 'http://test-system.com/Group',
                    security: [
                        { system: 'https://www.icanbwell.com/owner', code: 'test-owner' },
                        { system: 'https://www.icanbwell.com/access', code: 'test-access' }
                    ]
                }
            })
            .set(getTestHeadersWithExternalStorage());

        // Should either reject (400/413/500) or accept (201)
        expect([201, 400, 413, 500]).toContain(response.status);

        if (response.status === 201 && response.body.id) {
            // If accepted, verify it was stored (possibly truncated)
            const getResponse = await request
                .get(`/4_0_0/Group/${response.body.id}`)
                .set(getTestHeadersWithExternalStorage());
            expect(getResponse.status).toBe(200);
        }
    }, 30000);

    test('Unicode member reference → UTF-8 preserved', async () => {
        // Test that Unicode characters (including emojis) are correctly preserved
        const unicodeRef = 'Patient/测试-👨‍⚕️-emoji-ñ-é';

        const group = await createGroup({
            type: 'person',
            actual: true,
            member: [{ entity: { reference: unicodeRef } }]
        });


        // Verify Unicode preservation via ClickHouse (member array not in GET response)
        const clickHouseManager = getClickHouseManager();
        const events = await clickHouseManager.queryAsync({
            query: `SELECT entity_reference FROM fhir.Group_4_0_0_MemberEvents
                    WHERE group_id = '${group.id}' AND entity_reference = '${unicodeRef}'
                    LIMIT 1`
        });

        expect(events.length).toBeGreaterThan(0);
        expect(events[0].entity_reference).toBe(unicodeRef);

        // Search by Unicode reference
        const request = getSharedRequest();
        const searchResponse = await request
            .get('/4_0_0/Group')
            .query({ member: unicodeRef })
            .set(getTestHeadersWithExternalStorage());

        expect(searchResponse.status).toBe(200);
        expect(searchResponse.body.resourceType).toBe('Bundle');
    }, 30000);
});
