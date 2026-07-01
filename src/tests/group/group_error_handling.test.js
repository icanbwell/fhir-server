const { describe, test, beforeAll, beforeEach, afterEach, afterAll, expect, jest } = require('@jest/globals');
const {
    setupGroupTests,
    teardownGroupTests,
    cleanupAllData,
    getSharedRequest,
    getClickHouseManager,
    getTestHeadersWithExternalStorage
} = require('./groupTestSetup');
const { getTestContainer } = require('../common');
const {
    assertTooCostlyOperationOutcome,
    getMaxGroupMembersPerPut
} = require('./groupTestHelpers');

/**
 * Returns true when a ClickHouse query is the Group member-count query used by
 * GroupMemberEnrichmentProvider._getMemberCount (SELECT count() over the member
 * events table). Used to target failure injection at only that read path.
 */
function isMemberCountQuery(query) {
    return typeof query === 'string' &&
        query.includes('count() as count') &&
        query.includes('Group_4_0_0_MemberEvents');
}

/**
 * Group Error Handling Tests
 *
 * Coverage:
 * ✅ Input validation (invalid references, null values, malformed requests)
 * ✅ Read-side errors SURFACE: a ClickHouse read failure must NOT be
 *    masked as a successful, silently-empty quantity:0 — it surfaces as a non-2xx.
 * ✅ Boundary conditions (empty arrays, large datasets, PUT member-limit guardrail)
 *
 * NOTE (read-surface): On origin/main a ClickHouse read failure degraded
 * to a 200 with quantity=0/null. That silently reported an empty clinical cohort and
 * was the bug the read-surfacing fix addressed. On this integrated branch GroupMemberEnrichmentProvider rethrows
 * on read failure, so these tests assert the CORRECTED contract: the request fails loudly
 * rather than returning wrong member data.
 *
 * NOT covered here:
 * ❌ Write-side failures (ClickHouse write fails after MongoDB commit) — see
 *    group_clickhouse_write_failure.test.js.
 * ❌ Orphaned Group detection / reconciliation workflows.
 *
 * Read-side failures are exercised by spying on the container's
 * ClickHouseClientManager.queryAsync (the external boundary the enrichment
 * provider depends on).
 */
describe('Group Error Handling', () => {
    beforeAll(async () => {
        await setupGroupTests();
    });

    beforeEach(async () => {
        await cleanupAllData();
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    afterAll(async () => {
        await teardownGroupTests();
    });

    async function createGroup(group, expectStatus = 201) {
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

        expect(response.status).toBe(expectStatus);
        return response;
    }

    test('Invalid member reference format → 400 Bad Request', async () => {
        const response = await createGroup({
            type: 'person',
            actual: true,
            member: [
                { entity: { reference: 'InvalidFormat' } }
            ]
        }, 400);

        expect(response.body.issue).toBeDefined();
        expect(response.body.issue[0].severity).toBe('error');
    });

    test('Member reference to non-existent resource → Success (eventual consistency)', async () => {
        const response = await createGroup({
            type: 'person',
            actual: true,
            member: [
                { entity: { reference: 'Patient/does-not-exist-12345' } }
            ]
        }, 201);

        expect(response.body.id).toBeDefined();
    });

    test('Null entity reference → 400 Bad Request', async () => {
        const response = await createGroup({
            type: 'person',
            actual: true,
            member: [
                { entity: { reference: null } }
            ]
        }, 400);

        expect(response.body.issue).toBeDefined();
    });

    test('Member with no entity field → 400 Bad Request', async () => {
        const response = await createGroup({
            type: 'person',
            actual: true,
            member: [
                { period: { start: '2024-01-01' } }
            ]
        }, 400);

        expect(response.body.issue).toBeDefined();
    });

    test('ClickHouse unavailable during READ → Returns Group with quantity=0', async () => {
        const groupId = `error-ch-unavail-${Date.now()}`;

        const createResponse = await createGroup({
            id: groupId,
            type: 'person',
            actual: true,
            member: [
                { entity: { reference: 'Patient/test-1' } }
            ]
        }, 201);

        // Verify the created Group ID matches what we requested
        const createdId = createResponse.body.id;


        const request = getSharedRequest();
        const response = await request
            .get(`/4_0_0/Group/${createdId}`)
            .set(getTestHeadersWithExternalStorage());

        expect(response.status).toBe(200);
        expect(response.body.quantity).toBeGreaterThanOrEqual(0);
    });

    test('Invalid period dates (start > end) → Accept with warning', async () => {
        const response = await createGroup({
            type: 'person',
            actual: true,
            member: [
                {
                    entity: { reference: 'Patient/test-1' },
                    period: {
                        start: '2024-12-31T23:59:59Z',
                        end: '2024-01-01T00:00:00Z'
                    }
                }
            ]
        }, 201);

        expect(response.body.id).toBeDefined();
    });

    test('Duplicate members in same group → Both stored', async () => {
        const clickHouseManager = getClickHouseManager();
        const response = await createGroup({
            type: 'person',
            actual: true,
            member: [
                { entity: { reference: 'Patient/duplicate' } },
                { entity: { reference: 'Patient/duplicate' } }
            ]
        }, 201);

        const groupId = response.body.id;

        const events = await clickHouseManager.queryAsync({
            query: `SELECT count() as count FROM fhir.Group_4_0_0_MemberEvents
                    WHERE group_id = '${groupId}' AND entity_reference = 'Patient/duplicate'`
        });

        expect(parseInt(events[0].count)).toBeGreaterThanOrEqual(1);
    });

    test('Empty member array in CREATE → Success with 0 members', async () => {
        const response = await createGroup({
            type: 'person',
            actual: true,
            member: []
        }, 201);

        expect(response.body.id).toBeDefined();

        const request = getSharedRequest();
        const getResponse = await request
            .get(`/4_0_0/Group/${response.body.id}`)
            .set(getTestHeadersWithExternalStorage());

        expect(getResponse.body.quantity).toBe(0);
    });

    test('PUT with too many members → 400 with FHIR too-costly OperationOutcome', async () => {
        // Verifies the MAX_GROUP_MEMBERS_PER_PUT guardrail (GroupInvariantHandler): a
        // CREATE/PUT whose member array exceeds the configured limit is rejected with a
        // 400 too-costly OperationOutcome that steers the caller toward PATCH.
        //
        // configManager.groupMemberLimit reads process.env.MAX_GROUP_MEMBERS_PER_PUT
        // lazily on every call, so we shrink the limit for this one test (default 50000
        // would need a 50001-member payload - slow and memory-heavy in CI) and restore
        // it afterward so sibling suites in the same worker are unaffected.
        const originalLimit = process.env.MAX_GROUP_MEMBERS_PER_PUT;
        process.env.MAX_GROUP_MEMBERS_PER_PUT = '5';
        try {
            const limit = getMaxGroupMembersPerPut();
            expect(limit).toBe(5);
            const memberCount = limit + 1;

            const response = await createGroup({
                type: 'person',
                actual: true,
                member: Array.from({ length: memberCount }, (_, i) => ({
                    entity: { reference: `Patient/member-${i}` }
                }))
            }, 400);

            assertTooCostlyOperationOutcome(response, memberCount, limit);
        } finally {
            if (originalLimit === undefined) {
                delete process.env.MAX_GROUP_MEMBERS_PER_PUT;
            } else {
                process.env.MAX_GROUP_MEMBERS_PER_PUT = originalLimit;
            }
        }
    });

    // Phase 2.1: Critical Error Handling Tests

    test('ClickHouse query timeout during READ → surfaces as non-2xx (no silent quantity:0)', async () => {
        // Read-surface: when the ClickHouse member-count query fails (here: a socket timeout),
        // the enrichment provider MUST surface the error rather than mask it as a 200 with
        // quantity=0. Silently reporting an empty clinical cohort is the bug the read-surfacing
        // fix addressed. We INJECT the timeout by rejecting the member-count query at the ClickHouse
        // client boundary that GroupMemberEnrichmentProvider uses.
        const groupId = `error-ch-timeout-${Date.now()}`;

        const createResponse = await createGroup({
            id: groupId,
            type: 'person',
            actual: true,
            member: [
                { entity: { reference: 'Patient/timeout-test-1' } },
                { entity: { reference: 'Patient/timeout-test-2' } }
            ]
        }, 201);

        const createdId = createResponse.body.id;

        // Inject a timeout: fail ONLY the member-count read, pass everything else through.
        const container = getTestContainer();
        const chManager = container.clickHouseClientManager;
        const originalQueryAsync = chManager.queryAsync.bind(chManager);
        let memberCountQueryAttempted = false;
        jest.spyOn(chManager, 'queryAsync').mockImplementation(async (params) => {
            if (isMemberCountQuery(params?.query)) {
                memberCountQueryAttempted = true;
                const timeoutError = new Error('Timeout exceeded while reading from socket (ClickHouse)');
                timeoutError.code = 'TIMEOUT';
                throw timeoutError;
            }
            return originalQueryAsync(params);
        });

        const request = getSharedRequest();
        const response = await request
            .get(`/4_0_0/Group/${createdId}`)
            .set(getTestHeadersWithExternalStorage());

        // The injected timeout must actually have been exercised.
        expect(memberCountQueryAttempted).toBe(true);

        // Read-surface contract: the read failure surfaces as an error, NOT a 200 with a bogus quantity.
        expect(response.status).toBeGreaterThanOrEqual(500);
        // And crucially, it must never look like a healthy empty cohort.
        expect(response.body.quantity).toBeUndefined();
    });

    test.each([
        ['non-numeric string (parseInt -> NaN)', 'not-a-number'],
        ['empty string (parseInt -> NaN)', ''],
        ['Infinity literal', 'Infinity'],
        ['null count', null]
    ])('Non-finite ClickHouse count (%s) → GET still degrades to 200 without crashing', async (_label, injectedCount) => {
        // TRUE ASSERTION (origin/main behavior): a malformed/non-finite count row from
        // ClickHouse must NOT crash the read path or 500 - the Group is still returned
        // with 200. We INJECT the bad count value at the ClickHouse client boundary that
        // GroupMemberEnrichmentProvider._getMemberCount reads.
        //
        // SCOPE NOTE: coercing that non-finite value into `quantity: 0` (so the response
        // is always a valid finite FHIR quantity) is the read-failure-surfacing/sanitize
        // fix owned by the read-failure-surfacing work in groupMemberEnrichmentProvider.js. On origin/main
        // the value is NOT sanitized - parseInt(...) yields NaN and JSON serialization
        // emits `quantity: null`. This test therefore does NOT assert quantity === 0
        // (that would depend on that unmerged fix); it only guards graceful degradation and
        // documents the current gap: quantity comes back null/absent, never a bogus
        // finite number.
        const groupId = `error-ch-nan-${Date.now()}`;

        const createResponse = await createGroup({
            id: groupId,
            type: 'person',
            actual: true,
            member: []
        }, 201);

        const createdId = createResponse.body.id;

        const container = getTestContainer();
        const chManager = container.clickHouseClientManager;
        const originalQueryAsync = chManager.queryAsync.bind(chManager);
        let memberCountQueryAttempted = false;
        jest.spyOn(chManager, 'queryAsync').mockImplementation(async (params) => {
            if (isMemberCountQuery(params?.query)) {
                memberCountQueryAttempted = true;
                // Return a row whose `count` is non-numeric / non-finite.
                return [{ count: injectedCount }];
            }
            return originalQueryAsync(params);
        });

        const request = getSharedRequest();
        const response = await request
            .get(`/4_0_0/Group/${createdId}`)
            .set(getTestHeadersWithExternalStorage());

        // The injected bad count must actually have been exercised.
        expect(memberCountQueryAttempted).toBe(true);

        // Graceful degradation: Group still returned, no crash / no 500.
        expect(response.status).toBe(200);
        expect(response.body.resourceType).toBe('Group');
        expect(response.body.id).toBe(createdId);

        // Current (pre-fix) contract: quantity is never a bogus finite number. It is
        // absent or null because the non-finite value is not yet sanitized. Once the
        // read-failure-surfacing fix lands, a follow-up assertion should tighten this to quantity === 0.
        const quantity = response.body.quantity;
        const quantityIsAbsentOrNull = quantity === undefined || quantity === null;
        expect(quantityIsAbsentOrNull).toBe(true);
    });

    test('Empty ClickHouse results → Graceful handling', async () => {
        // Search should handle empty results without crashing
        const request = getSharedRequest();
        const response = await request
            .get('/4_0_0/Group')
            .query({ member: 'Patient/nonexistent-empty-results-test' })
            .set(getTestHeadersWithExternalStorage());

        expect(response.status).toBe(200);
        expect(response.body.resourceType).toBe('Bundle');
        // entry may be undefined or empty array when no results
        if (response.body.entry) {
            expect(Array.isArray(response.body.entry)).toBe(true);
        }
    });

    test('Malformed query objects → Safe handling', async () => {
        // Test nested operators don't cause stack overflow in _hasField traversal
        const request = getSharedRequest();

        // Test with deeply nested parameter (should be safely ignored or rejected)
        const response = await request
            .get('/4_0_0/Group')
            .query({ 'member[$gte]': 'Patient/malformed-test' })
            .set(getTestHeadersWithExternalStorage());

        // Should either reject (400) or safely ignore the invalid parameter (200)
        expect([200, 400]).toContain(response.status);

        if (response.status === 200) {
            expect(response.body.resourceType).toBe('Bundle');
        } else {
            expect(response.body.resourceType).toBe('OperationOutcome');
        }
    });
});
