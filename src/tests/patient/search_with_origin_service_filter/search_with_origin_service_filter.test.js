const patient1Resource = require('./fixtures/patient/patient1.json');
const patient2Resource = require('./fixtures/patient/patient2.json');

const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    createTestRequest
} = require('../../common');
const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');

describe('Patient Search with Origin Service Filter', () => {
    let originalEnv;

    beforeEach(async () => {
        originalEnv = process.env.SERVICES_WITH_QUERY_PARAM_FILTER_CONFIG;
        await commonBeforeEach();
    });

    afterEach(async () => {
        process.env.SERVICES_WITH_QUERY_PARAM_FILTER_CONFIG = originalEnv;
        await commonAfterEach();
    });

    test('strips query params when request is from configured API gateway', async () => {
        process.env.SERVICES_WITH_QUERY_PARAM_FILTER_CONFIG = 'example-gateway-name';

        const request = await createTestRequest();

        // Create two patients with different families
        let resp = await request
            .post('/4_0_0/Patient/00100000000/$merge?validate=true')
            .send(patient1Resource)
            .set(getHeaders());
        expect(resp).toHaveMergeResponse({ created: true });

        resp = await request
            .post('/4_0_0/Patient/00100000001/$merge?validate=true')
            .send(patient2Resource)
            .set(getHeaders());
        expect(resp).toHaveMergeResponse({ created: true });

        // Verify both patients exist
        resp = await request.get('/4_0_0/Patient').set(getHeaders());
        expect(resp).toHaveResourceCount(2);

        // Search with family=NONEXISTENT and origin-service header matching env
        // family filter should be stripped, so both patients should be returned
        resp = await request
            .get('/4_0_0/Patient?family=NONEXISTENT')
            .set({
                ...getHeaders(),
                'origin-service': 'example-gateway-name'
            });

        // Query params are stripped, so family filter is ignored and both patients are returned
        expect(resp).toHaveResourceCount(2);
    });

    test('preserves query params when request is NOT from API gateway', async () => {
        process.env.SERVICES_WITH_QUERY_PARAM_FILTER_CONFIG = 'example-gateway-name';

        const request = await createTestRequest();

        // Create two patients
        let resp = await request
            .post('/4_0_0/Patient/00100000000/$merge?validate=true')
            .send(patient1Resource)
            .set(getHeaders());
        expect(resp).toHaveMergeResponse({ created: true });

        resp = await request
            .post('/4_0_0/Patient/00100000001/$merge?validate=true')
            .send(patient2Resource)
            .set(getHeaders());
        expect(resp).toHaveMergeResponse({ created: true });

        // Search with family=NONEXISTENT but WITHOUT origin-service header
        resp = await request
            .get('/4_0_0/Patient?family=NONEXISTENT')
            .set(getHeaders());

        // Query params preserved, so family=NONEXISTENT returns no results
        expect(resp).toHaveResourceCount(0);
    });

    test('preserves query params when SERVICES_WITH_QUERY_PARAM_FILTER_CONFIG env is not set', async () => {
        process.env.SERVICES_WITH_QUERY_PARAM_FILTER_CONFIG = '';

        const request = await createTestRequest();

        // Create two patients
        let resp = await request
            .post('/4_0_0/Patient/00100000000/$merge?validate=true')
            .send(patient1Resource)
            .set(getHeaders());
        expect(resp).toHaveMergeResponse({ created: true });

        resp = await request
            .post('/4_0_0/Patient/00100000001/$merge?validate=true')
            .send(patient2Resource)
            .set(getHeaders());
        expect(resp).toHaveMergeResponse({ created: true });

        // Even with origin-service header, env is empty so filter shouldn't apply
        resp = await request
            .get('/4_0_0/Patient?family=NONEXISTENT')
            .set({
                ...getHeaders(),
                'origin-service': 'example-gateway-name'
            });

        // Query params preserved since env is not set
        expect(resp).toHaveResourceCount(0);
    });

    test('preserves query params when origin-service header does not match env', async () => {
        process.env.SERVICES_WITH_QUERY_PARAM_FILTER_CONFIG = 'example-gateway-name';

        const request = await createTestRequest();

        // Create two patients
        let resp = await request
            .post('/4_0_0/Patient/00100000000/$merge?validate=true')
            .send(patient1Resource)
            .set(getHeaders());
        expect(resp).toHaveMergeResponse({ created: true });

        resp = await request
            .post('/4_0_0/Patient/00100000001/$merge?validate=true')
            .send(patient2Resource)
            .set(getHeaders());
        expect(resp).toHaveMergeResponse({ created: true });

        // origin-service header does not match the env var
        resp = await request
            .get('/4_0_0/Patient?family=NONEXISTENT')
            .set({
                ...getHeaders(),
                'origin-service': 'different-gateway-name'
            });

        // Query params preserved, filter not applied
        expect(resp).toHaveResourceCount(0);
    });

    test('does not strip query params for non-Patient resources from gateway', async () => {
        process.env.SERVICES_WITH_QUERY_PARAM_FILTER_CONFIG = 'example-gateway-name';

        const request = await createTestRequest();

        // Search Observation with origin-service header
        // Patient is in config but Observation is not, so params should be preserved
        const resp = await request
            .get('/4_0_0/Observation?_count=1')
            .set({
                ...getHeaders(),
                'origin-service': 'example-gateway-name'
            });

        // Should return a bundle (params preserved, not stripped)
        expect(resp).toHaveStatusCode(200);
    });

    test('skips filter when both env and origin-service header are empty strings', async () => {
        process.env.SERVICES_WITH_QUERY_PARAM_FILTER_CONFIG = '';

        const request = await createTestRequest();

        // Create two patients
        let resp = await request
            .post('/4_0_0/Patient/00100000000/$merge?validate=true')
            .send(patient1Resource)
            .set(getHeaders());
        expect(resp).toHaveMergeResponse({ created: true });

        resp = await request
            .post('/4_0_0/Patient/00100000001/$merge?validate=true')
            .send(patient2Resource)
            .set(getHeaders());
        expect(resp).toHaveMergeResponse({ created: true });

        // Both env and header are empty strings — filter should NOT trigger
        resp = await request
            .get('/4_0_0/Patient?family=NONEXISTENT')
            .set({
                ...getHeaders(),
                'origin-service': ''
            });

        // Query params preserved, family=NONEXISTENT returns no results
        expect(resp).toHaveResourceCount(0);
    });

    test('preserves system params like base_version when filter is applied', async () => {
        process.env.SERVICES_WITH_QUERY_PARAM_FILTER_CONFIG = 'example-gateway-name';

        const request = await createTestRequest();

        // Create a patient
        let resp = await request
            .post('/4_0_0/Patient/00100000000/$merge?validate=true')
            .send(patient1Resource)
            .set(getHeaders());
        expect(resp).toHaveMergeResponse({ created: true });

        // Search from gateway — should not error out due to missing base_version
        resp = await request
            .get('/4_0_0/Patient?family=NONEXISTENT')
            .set({
                ...getHeaders(),
                'origin-service': 'example-gateway-name'
            });

        // Should succeed (base_version preserved) and return patient (family filter stripped)
        expect(resp).toHaveStatusCode(200);
        expect(resp).toHaveResourceCount(1);
    });
});
