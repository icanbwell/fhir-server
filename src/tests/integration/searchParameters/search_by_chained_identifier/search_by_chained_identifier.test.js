const patient1Resource = require('./fixtures/Patient/patient1.json');
const patient2Resource = require('./fixtures/Patient/patient2.json');
const observation1Resource = require('./fixtures/Observation/observation1.json');
const observation2Resource = require('./fixtures/Observation/observation2.json');

const { commonBeforeEach, commonAfterEach, getHeaders, createTestRequest } = require('../../common');
const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');

function idsInBundle (resp) {
    return ((resp.body && resp.body.entry) || [])
        .map((e) => e.resource && e.resource.id)
        .filter(Boolean);
}

async function seed () {
    const request = await createTestRequest();
    const resp = await request
        .post('/4_0_0/Patient/1/$merge')
        .send([patient1Resource, patient2Resource, observation1Resource, observation2Resource])
        .set(getHeaders());
    expect(resp).toHaveMergeResponse({ created: true });
    return request;
}

describe('Observation search_by_chained_identifier Tests', () => {
    beforeEach(async () => { await commonBeforeEach(); });
    afterEach(async () => { await commonAfterEach(); });

    test('untyped chain (patient.identifier) returns only the Observation whose patient has that identifier', async () => {
        const request = await seed();
        const resp = await request
            .get('/4_0_0/Observation?_bundle=1&patient.identifier=http://example.com/fhir/identifier/mrn|123456')
            .set(getHeaders());
        expect(resp.status).toBe(200);
        expect(idsInBundle(resp)).toEqual([observation1Resource.id]);
    });

    test('typed chain (subject:Patient.identifier) returns the same result as the untyped patient.identifier chain', async () => {
        const request = await seed();
        const resp = await request
            .get('/4_0_0/Observation?_bundle=1&subject:Patient.identifier=http://example.com/fhir/identifier/mrn|123456')
            .set(getHeaders());
        expect(resp.status).toBe(200);
        expect(idsInBundle(resp)).toEqual([observation1Resource.id]);
    });

    test('ambiguous untyped chain on a multi-target reference param is rejected with 400', async () => {
        const request = await seed();
        // performer targets 6 resource types on Observation -- untyped chain must be rejected
        const resp = await request
            .get('/4_0_0/Observation?_bundle=1&performer.identifier=http://example.com/fhir/identifier/mrn|123456')
            .set(getHeaders());
        expect(resp.status).toBe(400);
    });

    test('chain with no matching identifier returns an empty result, not an unfiltered search', async () => {
        const request = await seed();
        const resp = await request
            .get('/4_0_0/Observation?_bundle=1&patient.identifier=http://example.com/fhir/identifier/mrn|no-such-value')
            .set(getHeaders());
        expect(resp.status).toBe(200);
        expect(idsInBundle(resp)).toEqual([]);
    });
});
