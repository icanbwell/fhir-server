
const { describe, test, beforeAll, beforeEach, afterAll, expect } = require('@jest/globals');
const {
    setupGroupTests,
    teardownGroupTests,
    cleanupAllData,
    getSharedRequest,
    getClickHouseManager,
    getScopedHeaders,
    syncClickHouseMaterializedViews
} = require('./groupTestSetup');

/**
 * Tenant isolation for ClickHouse-backed Group membership.
 *
 * A Group is identified in ClickHouse by group_uuid, which carries MongoDB's
 * _uuid = uuidv5(id|sourceAssigningAuthority). group_id holds the FHIR logical id, which is
 * client-settable via update-as-create and therefore unique only within a tenant; it is provenance
 * in these tables, not identity.
 *
 * These tests exercise the read and write paths with two tenants sharing one logical id. They use
 * `PUT /Group/<same-id>` under different owner/access tags, which is the only way a client can
 * choose the id (POST assigns a server-generated UUID, which cannot collide).
 */
describe('Group ClickHouse tenant isolation (shared logical id)', () => {
    const TENANT_A = 'tenant-a';
    const TENANT_B = 'tenant-b';

    beforeAll(async () => {
        await setupGroupTests();
    });

    beforeEach(async () => {
        await cleanupAllData();
    });

    afterAll(async () => {
        await teardownGroupTests();
    });

    /**
     * Writes a Group under a client-chosen logical id, owned by the given tenant.
     * @param {Object} params
     * @param {string} params.id - Client-assigned logical id
     * @param {string} params.tenant
     * @param {string[]} params.memberReferences
     * @returns {Promise<Object>} supertest response
     */
    async function putGroupForTenant({ id, tenant, memberReferences }) {
        return await getSharedRequest()
            .put(`/4_0_0/Group/${id}`)
            .send({
                resourceType: 'Group',
                id,
                type: 'person',
                actual: true,
                name: `Cohort ${tenant}`,
                member: memberReferences.map(reference => ({ entity: { reference } })),
                meta: {
                    source: 'http://test-system.com/Group',
                    security: [
                        { system: 'https://www.icanbwell.com/owner', code: tenant },
                        { system: 'https://www.icanbwell.com/access', code: tenant }
                    ]
                }
            })
            .set(getScopedHeaders(tenant));
    }

    test('quantity is per-tenant, not the union of every tenant sharing the id', async () => {
        const sharedId = 'tenant-isolation-quantity';

        const createdA = await putGroupForTenant({
            id: sharedId,
            tenant: TENANT_A,
            memberReferences: [
                'Patient/isolation-a1',
                'Patient/isolation-a2',
                'Patient/isolation-a3'
            ]
        });
        const createdB = await putGroupForTenant({
            id: sharedId,
            tenant: TENANT_B,
            memberReferences: ['Patient/isolation-b1']
        });

        // Both writes succeed: MongoDB distinguishes them by _uuid, so this is a legitimate
        // pair of Groups, not a duplicate-id error.
        expect(createdA.status).toBe(201);
        expect(createdB.status).toBe(201);

        const request = getSharedRequest();

        const readA = await request
            .get(`/4_0_0/Group/${sharedId}`)
            .set(getScopedHeaders(TENANT_A));
        const readB = await request
            .get(`/4_0_0/Group/${sharedId}`)
            .set(getScopedHeaders(TENANT_B));

        // Each tenant reads its own MongoDB document — confirming these really are two
        // separate Groups and the counts below are not an artifact of reading one document.
        expect(readA.status).toBe(200);
        expect(readB.status).toBe(200);
        expect(readA.body.name).toBe(`Cohort ${TENANT_A}`);
        expect(readB.body.name).toBe(`Cohort ${TENANT_B}`);

        // Each tenant sees the size of its own roster, not the union.
        expect(readA.body.quantity).toBe(3);
        expect(readB.body.quantity).toBe(1);
    }, 30000);

    test('a tenant update does not remove another tenant\'s members', async () => {
        const sharedId = 'tenant-isolation-update';

        await putGroupForTenant({
            id: sharedId,
            tenant: TENANT_A,
            memberReferences: ['Patient/update-a1', 'Patient/update-a2']
        });
        await putGroupForTenant({
            id: sharedId,
            tenant: TENANT_B,
            memberReferences: ['Patient/update-b1']
        });

        // A second write by tenant B. The stored document now exists, so the update path
        // hydrates the current roster from ClickHouse and diffs the incoming roster against it.
        const updateB = await putGroupForTenant({
            id: sharedId,
            tenant: TENANT_B,
            memberReferences: ['Patient/update-b1', 'Patient/update-b2']
        });
        expect(updateB.status).toBe(200);

        await syncClickHouseMaterializedViews();

        const removalsAgainstTenantA = await getClickHouseManager().queryAsync({
            query: `SELECT entity_reference, group_source_assigning_authority AS gsaa
                    FROM fhir.Group_4_0_0_MemberEvents
                    WHERE event_type = 'removed'
                      AND entity_reference IN ('Patient/update-a1', 'Patient/update-a2')
                    ORDER BY entity_reference`
        });

        // No write by tenant B may ever produce a removal for a tenant A member.
        expect(removalsAgainstTenantA).toEqual([]);

        const request = getSharedRequest();

        // And tenant A's roster must be intact afterwards.
        const readA = await request
            .get(`/4_0_0/Group/${sharedId}`)
            .set(getScopedHeaders(TENANT_A));
        expect(readA.status).toBe(200);
        expect(readA.body.quantity).toBe(2);

        const readB = await request
            .get(`/4_0_0/Group/${sharedId}`)
            .set(getScopedHeaders(TENANT_B));
        expect(readB.status).toBe(200);
        expect(readB.body.quantity).toBe(2);
    }, 30000);

    test('quantity is correct under Prefer: global_id=true, which rewrites resource.id', async () => {
        // GlobalIdEnrichmentProvider sets resource.id = resource._uuid before the Group enricher
        // runs, so a count keyed on resource.id would query for a group with no rows and report 0.
        const id = 'global-id-quantity';

        const created = await putGroupForTenant({
            id,
            tenant: TENANT_A,
            memberReferences: ['Patient/global-a1', 'Patient/global-a2', 'Patient/global-a3']
        });
        expect(created.status).toBe(201);

        const read = await getSharedRequest()
            .get(`/4_0_0/Group/${id}`)
            .set({ ...getScopedHeaders(TENANT_A), Prefer: 'global_id=true' });

        expect(read.status).toBe(200);
        // The response id is the _uuid, confirming the enrichment actually ran.
        expect(read.body.id).not.toBe(id);
        expect(read.body.quantity).toBe(3);
    }, 30000);

    test('member search returns only the caller tenant\'s Group when a logical id is shared', async () => {
        // The ClickHouse page is handed to MongoDB as a single $in list. Keyed on the logical id
        // that list matches both tenants' documents; keyed on _uuid it matches exactly one.
        const sharedId = 'tenant-isolation-reverse-lookup';
        const sharedMember = 'Patient/reverse-shared';

        await putGroupForTenant({
            id: sharedId,
            tenant: TENANT_A,
            memberReferences: [sharedMember]
        });
        await putGroupForTenant({
            id: sharedId,
            tenant: TENANT_B,
            memberReferences: [sharedMember]
        });

        await syncClickHouseMaterializedViews();

        const searchB = await getSharedRequest()
            .get(`/4_0_0/Group?member=${sharedMember}`)
            .set(getScopedHeaders(TENANT_B));

        expect(searchB.status).toBe(200);
        const returnedNames = (searchB.body.entry || []).map(entry => entry.resource.name);
        expect(returnedNames).toEqual([`Cohort ${TENANT_B}`]);
    }, 30000);
});
