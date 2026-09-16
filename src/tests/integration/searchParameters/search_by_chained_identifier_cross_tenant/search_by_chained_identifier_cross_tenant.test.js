// review.md §E: a chained search's sub-search must not leak another tenant's matching
// resource, even when both tenants share the same identifier value.

const tenantAPatientResource = require('./fixtures/Patient/tenant_a_patient.json');
const tenantBPatientResource = require('./fixtures/Patient/tenant_b_patient.json');
const observationTenantAResource = require('./fixtures/Observation/observation_tenant_a.json');
const observationTenantBResource = require('./fixtures/Observation/observation_tenant_b.json');

const { commonBeforeEach, commonAfterEach, getHeaders, createTestRequest } = require('../../common');
const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');

const allResources = [
    tenantAPatientResource, tenantBPatientResource,
    observationTenantAResource, observationTenantBResource
];

const CHAIN_QUERY = '/4_0_0/Observation?patient.identifier=http://example.com/fhir/identifier/mrn|SHARED-777';

const tenantAHeaders = getHeaders('user/*.read access/tenantA.*');
const tenantBHeaders = getHeaders('user/*.read access/tenantB.*');

function idsInBundle (resp) {
    return ((resp.body && resp.body.entry) || [])
        .map((e) => e.resource && e.resource.id)
        .filter(Boolean);
}

async function seed () {
    const request = await createTestRequest();
    const resp = await request
        .post('/4_0_0/Patient/1/$merge')
        .send(allResources)
        .set(getHeaders());
    expect(resp).toHaveMergeResponse({ created: true });
    return request;
}

describe('chained search cross-tenant isolation (review.md §E)', () => {
    beforeEach(async () => { await commonBeforeEach(); });
    afterEach(async () => { await commonAfterEach(); });

    test('reachability control: a full-access caller\'s chain sees both tenants\' Observations', async () => {
        const request = await seed();
        const resp = await request.get(CHAIN_QUERY).set(getHeaders('user/*.read access/*.*'));
        expect(resp.status).toBe(200);
        const ids = idsInBundle(resp);
        expect(ids).toEqual(expect.arrayContaining([
            observationTenantAResource.id, observationTenantBResource.id
        ]));
    });

    test('positive control: tenantA sees its own Observation via the chain', async () => {
        const request = await seed();
        const resp = await request.get(CHAIN_QUERY).set(tenantAHeaders);
        expect(resp.status).toBe(200);
        expect(idsInBundle(resp)).toContain(observationTenantAResource.id);
    });

    test('positive control: tenantB sees its own Observation via the chain', async () => {
        const request = await seed();
        const resp = await request.get(CHAIN_QUERY).set(tenantBHeaders);
        expect(resp.status).toBe(200);
        expect(idsInBundle(resp)).toContain(observationTenantBResource.id);
    });

    test('tenantA\'s chain must NOT return tenantB\'s Observation despite the shared identifier value', async () => {
        const request = await seed();
        const resp = await request.get(CHAIN_QUERY).set(tenantAHeaders);
        const ids = idsInBundle(resp);
        expect(ids).not.toContain(observationTenantBResource.id);
        expect(ids).toEqual([observationTenantAResource.id]);
    });

    test('tenantB\'s chain must NOT return tenantA\'s Observation despite the shared identifier value', async () => {
        const request = await seed();
        const resp = await request.get(CHAIN_QUERY).set(tenantBHeaders);
        const ids = idsInBundle(resp);
        expect(ids).not.toContain(observationTenantAResource.id);
        expect(ids).toEqual([observationTenantBResource.id]);
    });
});
