const patient1Resource = require('./fixtures/patient/patient1.json');
const patient2Resource = require('./fixtures/patient/patient2.json');
const person1Resource = require('./fixtures/person/person1.json');
const observation1Resource = require('./fixtures/observation/observation1.json');
const observation2Resource = require('./fixtures/observation/observation2.json');

const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    getHeadersWithCustomPayload,
    createTestRequest
} = require('../../common');
const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');

const patient1Id = 'a1c2d3e4-f5a6-47b8-89c0-d1e2f3a4b5c6';
const patient2Id = 'b2d3e4f5-a6b7-48c9-90d1-e2f3a4b5c6d7';
const personId = 'c3e4f5a6-b7c8-49d0-a1e2-f3a4b5c6d7e8';
const observation1Id = 'd4f5a6b7-c8d9-4e0f-a1b2-c3d4e5f6a7b8';
const observation2Id = 'e5a6b7c8-d9e0-4f1a-b2c3-d4e5f6a7b8c9';

const patientPayload = {
    token_use: 'access',
    client_id: 'test-client-id',
    scope: 'patient/*.read',
    username: 'patient-user',
    clientFhirPersonId: personId,
    clientFhirPatientId: patient1Id,
    bwellFhirPersonId: personId,
    bwellFhirPatientId: patient1Id
};

const getPatientHeaders = () => getHeadersWithCustomPayload(patientPayload);

/**
 * Helper to set up test data: two patients + a person linked to both
 */
const setupTestData = async (request) => {
    const resp = await request
        .post(`/4_0_0/Patient/${patient1Id}/$merge?validate=true`)
        .send([patient1Resource, patient2Resource, person1Resource])
        .set(getHeaders());
    expect(resp).toHaveMergeResponse([{ created: true }, { created: true }, { created: true }]);
};

describe('Patient Search with Origin Service Query Param Filter', () => {
    let originalEnv;

    beforeEach(async () => {
        originalEnv = process.env.SERVICES_WITH_QUERY_PARAM_FILTER_CONFIG;
        await commonBeforeEach();
    });

    afterEach(async () => {
        process.env.SERVICES_WITH_QUERY_PARAM_FILTER_CONFIG = originalEnv;
        await commonAfterEach();
    });

    test('strips query params when request is from a configured origin service', async () => {
        process.env.SERVICES_WITH_QUERY_PARAM_FILTER_CONFIG = 'example-service';

        const request = await createTestRequest();
        await setupTestData(request);

        // Verify both patients are accessible with patient scope
        let resp = await request.get('/4_0_0/Patient').set(getPatientHeaders());
        expect(resp).toHaveResourceCount(2);

        // Search with family=NONEXISTENT and origin-service header matching env
        // family filter should be stripped, so both patients should be returned
        resp = await request
            .get('/4_0_0/Patient?family=NONEXISTENT')
            .set({
                ...getPatientHeaders(),
                'origin-service': 'example-service'
            });

        // Query params are stripped, so family filter is ignored and both patients are returned
        expect(resp).toHaveResourceCount(2);
    });

    test('preserves query params when request is NOT from a configured origin service', async () => {
        process.env.SERVICES_WITH_QUERY_PARAM_FILTER_CONFIG = 'example-service';

        const request = await createTestRequest();
        await setupTestData(request);

        // Search with family=NONEXISTENT but WITHOUT origin-service header
        const resp = await request
            .get('/4_0_0/Patient?family=NONEXISTENT')
            .set(getPatientHeaders());

        // Query params preserved, so family=NONEXISTENT returns no results
        expect(resp).toHaveResourceCount(0);
    });

    test('preserves query params when env is not set', async () => {
        process.env.SERVICES_WITH_QUERY_PARAM_FILTER_CONFIG = '';

        const request = await createTestRequest();
        await setupTestData(request);

        // Even with origin-service header, env is empty so filter shouldn't apply
        const resp = await request
            .get('/4_0_0/Patient?family=NONEXISTENT')
            .set({
                ...getPatientHeaders(),
                'origin-service': 'example-service'
            });

        // Query params preserved since env is not set
        expect(resp).toHaveResourceCount(0);
    });

    test('preserves query params when origin-service header does not match env', async () => {
        process.env.SERVICES_WITH_QUERY_PARAM_FILTER_CONFIG = 'example-service';

        const request = await createTestRequest();
        await setupTestData(request);

        // origin-service header does not match the env var
        const resp = await request
            .get('/4_0_0/Patient?family=NONEXISTENT')
            .set({
                ...getPatientHeaders(),
                'origin-service': 'different-service'
            });

        // Query params preserved, filter not applied
        expect(resp).toHaveResourceCount(0);
    });

    test('does not strip query params for non-Patient resources from configured service', async () => {
        process.env.SERVICES_WITH_QUERY_PARAM_FILTER_CONFIG = 'example-service';

        const request = await createTestRequest();
        await setupTestData(request);

        // Create two observations
        let resp = await request
            .post(`/4_0_0/Observation/${observation1Id}/$merge?validate=true`)
            .send([observation1Resource, observation2Resource])
            .set(getHeaders());
        expect(resp).toHaveMergeResponse([{ created: true }, { created: true }]);

        // Verify both observations exist
        resp = await request.get('/4_0_0/Observation').set(getHeaders());
        expect(resp).toHaveResourceCount(2);

        // Search Observation with _count=1 from configured service
        // Observation is NOT in the filter config, so _count=1 should be preserved
        resp = await request
            .get('/4_0_0/Observation?_count=1')
            .set({
                ...getHeaders(),
                'origin-service': 'example-service'
            });

        // _count=1 is preserved, so only 1 observation returned
        expect(resp).toHaveResourceCount(1);
    });

    test('skips filter when both env and origin-service header are empty strings', async () => {
        process.env.SERVICES_WITH_QUERY_PARAM_FILTER_CONFIG = '';

        const request = await createTestRequest();
        await setupTestData(request);

        // Both env and header are empty strings — filter should NOT trigger
        const resp = await request
            .get('/4_0_0/Patient?family=NONEXISTENT')
            .set({
                ...getPatientHeaders(),
                'origin-service': ''
            });

        // Query params preserved, family=NONEXISTENT returns no results
        expect(resp).toHaveResourceCount(0);
    });

    test('does not affect Patient/:id endpoint from configured service', async () => {
        process.env.SERVICES_WITH_QUERY_PARAM_FILTER_CONFIG = 'example-service';

        const request = await createTestRequest();
        await setupTestData(request);

        // searchById is not in the filter config, so request should work normally
        const resp = await request
            .get(`/4_0_0/Patient/${patient1Id}`)
            .set({
                ...getPatientHeaders(),
                'origin-service': 'example-service'
            });

        // Should return the patient successfully
        expect(resp).toHaveStatusCode(200);
        expect(resp.body.resourceType).toBe('Patient');
        expect(resp.body.id).toBe(patient1Id);
    });
});
