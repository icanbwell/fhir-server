const { describe, test, beforeAll, beforeEach, afterAll, expect } = require('@jest/globals');
const {
    setupGroupTests,
    teardownGroupTests,
    cleanupBetweenTests,
    getSharedRequest,
    getTestHeaders,
    isClickHouseAvailable
} = require('./groupTestSetup');

describe('Individual Group Reads with ClickHouse', () => {
    beforeAll(async () => {
        await setupGroupTests();
    }, 180000); // Allow extra time on CI

    beforeEach(async () => {
        if (!isClickHouseAvailable()) return;
        await cleanupBetweenTests();
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
                source: 'http://read-test.com/Group',
                security: [
                    { system: 'https://www.icanbwell.com/owner', code: 'read-test' },
                    { system: 'https://www.icanbwell.com/access', code: 'read-test' }
                ]
            },
            type: 'person',
            actual: true,
            name: `Read Test Group ${id}`,
            member: members
        };

        const response = await request
            .post('/4_0_0/Group')
            .send(group)
            .set(getTestHeaders());

        expect(response.status).toBe(201);
        return response.body;
    }

    test('GET /Group/{id} returns quantity field, strips member array', async () => {
        if (!isClickHouseAvailable()) { console.log('Skipping - ClickHouse not available'); return; }
        // Create Group with 100 members
        const members = Array.from({ length: 100 }, (_, i) => ({
            entity: { reference: `Patient/read-test-${i}` }
        }));

        const created = await createGroup({
            members
        });


        const request = getSharedRequest();

        // GET the Group by ID
        const response = await request
            .get(`/4_0_0/Group/${created.id}`)
            .set(getTestHeaders());

        expect(response.status).toBe(200);
        expect(response.body.resourceType).toBe('Group');
        expect(response.body.id).toBe(created.id);

        // Verify enrichment: quantity field present, member array stripped
        expect(response.body.quantity).toBe(100);
        expect(response.body.member).toBeUndefined();
    }, 30000);

    test('GET /Group/{id} for empty Group returns quantity=0', async () => {
        if (!isClickHouseAvailable()) { console.log('Skipping - ClickHouse not available'); return; }
        const created = await createGroup({
            members: []
        });


        const request = getSharedRequest();

        const response = await request
            .get(`/4_0_0/Group/${created.id}`)
            .set(getTestHeaders());

        expect(response.status).toBe(200);
        expect(response.body.resourceType).toBe('Group');
        expect(response.body.quantity).toBe(0);
        expect(response.body.member).toBeUndefined();
    }, 30000);

    test('GET /Group/{id} query performance <1000ms for large Groups', async () => {
        if (!isClickHouseAvailable()) { console.log('Skipping - ClickHouse not available'); return; }
        // Create Group with 10K members
        const members = Array.from({ length: 10000 }, (_, i) => ({
            entity: { reference: `Patient/perf-test-${i}` }
        }));

        const created = await createGroup({
            members
        });


        const request = getSharedRequest();

        // Measure query time
        const start = Date.now();
        const response = await request
            .get(`/4_0_0/Group/${created.id}`)
            .set(getTestHeaders());
        const queryTime = Date.now() - start;

        expect(response.status).toBe(200);
        expect(response.body.quantity).toBe(10000);
        expect(response.body.member).toBeUndefined();

        // Performance check: should be reasonably fast
        // Using 1000ms (1 second) as conservative threshold
        // (100ms may be too strict for CI environments)
        expect(queryTime).toBeLessThan(1000);
    }, 60000);

    test('GET /Group/{id} with 1K members returns correct quantity', async () => {
        if (!isClickHouseAvailable()) { console.log('Skipping - ClickHouse not available'); return; }
        const members = Array.from({ length: 1000 }, (_, i) => ({
            entity: { reference: `Patient/medium-test-${i}` }
        }));

        const created = await createGroup({
            members
        });


        const request = getSharedRequest();

        const response = await request
            .get(`/4_0_0/Group/${created.id}`)
            .set(getTestHeaders());

        expect(response.status).toBe(200);
        expect(response.body.quantity).toBe(1000);
        expect(response.body.member).toBeUndefined();
    }, 30000);

    test('GET /Group/{id} for non-existent Group returns 404', async () => {
        if (!isClickHouseAvailable()) { console.log('Skipping - ClickHouse not available'); return; }
        const request = getSharedRequest();

        const response = await request
            .get(`/4_0_0/Group/non-existent-group-${Date.now()}`)
            .set(getTestHeaders());

        expect(response.status).toBe(404);
    }, 30000);

    test('GET /Group/{id} preserves other Group fields', async () => {
        if (!isClickHouseAvailable()) { console.log('Skipping - ClickHouse not available'); return; }
        const created = await createGroup({
            members: [
                { entity: { reference: 'Patient/field-test-1' } },
                { entity: { reference: 'Patient/field-test-2' } }
            ]
        });


        const request = getSharedRequest();

        const response = await request
            .get(`/4_0_0/Group/${created.id}`)
            .set(getTestHeaders());

        expect(response.status).toBe(200);

        // Verify other fields preserved
        expect(response.body.type).toBe('person');
        expect(response.body.actual).toBe(true);
        expect(response.body.name).toContain('Read Test Group');
        expect(response.body.meta).toBeDefined();
        expect(response.body.meta.source).toBe('http://read-test.com/Group');

        // Verify enrichment
        expect(response.body.quantity).toBe(2);
        expect(response.body.member).toBeUndefined();
    }, 30000);
});
