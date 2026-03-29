const patient1Resource = require('./fixtures/patient/patient1.json');
const patient2Resource = require('./fixtures/patient/patient2.json');
const patient3Resource = require('./fixtures/patient/patient3.json');
const person1Resource = require('./fixtures/person/person1.json');
const observation1Resource = require('./fixtures/observation/observation1.json');
const observation2Resource = require('./fixtures/observation/observation2.json');

const expectedPatientSearchResponse = require('./fixtures/expected/expectedPatientSearchResponse.json');
const expectedPatientSearchResponseExplain = require('./fixtures/expected/expectedPatientSearchResponseExplain.json');
const expectedPatientSearchResponseExternalService = require('./fixtures/expected/expectedPatientSearchResponseExternalService.json');
const expectedPatientSearchResponseExternalServiceSourceId = require('./fixtures/expected/expectedPatientSearchResponseExternalServiceSourceId.json.json');

const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    getHeadersWithCustomPayload,
    createTestRequest
} = require('../../common');
const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');

const patient1Id = 'a1c2d3e4-f5a6-47b8-89c0-d1e2f3a4b5c6';
const personId = 'c3e4f5a6-b7c8-49d0-a1e2-f3a4b5c6d7e8';
const observation1Id = 'd4f5a6b7-c8d9-4e0f-a1b2-c3d4e5f6a7b8';

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
 * Helper to set up test data: two patients + a person linked to both and unlinked patient
 */
const setupTestData = async (request) => {
    const resp = await request
        .post(`/4_0_0/Patient/${patient1Id}/$merge?validate=true`)
        .send([patient1Resource, patient2Resource, patient3Resource, person1Resource])
        .set(getHeaders());
    expect(resp).toHaveMergeResponse([{ created: true }, { created: true }, { created: true }, { created: true }]);
};

describe('Patient Search with Origin Service External Request Restrictions', () => {
    let originalEnv;
    let originalReturnBundle;

    beforeEach(async () => {
        originalEnv = process.env.EXTERNAL_SERVICES_WITH_REQ_LIMIT;
        originalReturnBundle = process.env.RETURN_BUNDLE;
        process.env.EXTERNAL_SERVICES_WITH_REQ_LIMIT = 'external-service|http://example.com/';
        process.env.RETURN_BUNDLE = '1';
        await commonBeforeEach();
    });

    afterEach(async () => {
        process.env.EXTERNAL_SERVICES_WITH_REQ_LIMIT = originalEnv;
        process.env.RETURN_BUNDLE = originalReturnBundle;
        await commonAfterEach();
    });

    test('only strips ignored params (_debug, _explain), applies URL prefix and default headers for configured service', async () => {
        const request = await createTestRequest();
        await setupTestData(request);

        // Verify all patients are accessible with patient scope without origin-service header
        let resp = await request.get('/4_0_0/Patient?_debug=1').set(getPatientHeaders());
        expect(resp).toHaveResponse(expectedPatientSearchResponse);
        resp = await request.get('/4_0_0/Patient?_explain=1').set(getPatientHeaders());
        expect(resp).toHaveResponse(expectedPatientSearchResponseExplain);

        // Search from external service — default prefer: global_id=true header applied, URL prefix added
        resp = await request.get('/4_0_0/Patient?_debug=1&_explain=1').set({
            ...getPatientHeaders(),
            'origin-service': 'external-service'
        });
        // Default params and headers are applied, returns global uuid and next url with relative URLs
        expect(resp.body.link).toMatchObject([
            {
                relation: 'self',
                url: 'http://example.com/Patient?_debug=1&_explain=1'
            },
            {
                relation: 'next',
                url: 'http://example.com/Patient?_debug=1&_explain=1&id%3Aabove=b2d3e4f5-a6b7-48c9-90d1-e2f3a4b5c6d7'
            }
        ]);
        expect(resp).toHaveResponse(expectedPatientSearchResponseExternalService);

        // prefer: global_id=false overrides the default header, returns source IDs
        resp = await request.get('/4_0_0/Patient?_debug=1&_explain=1').set({
            ...getPatientHeaders(),
            prefer: 'global_id=false',
            'origin-service': 'external-service'
        });
        expect(resp).toHaveResponse(expectedPatientSearchResponseExternalServiceSourceId);
    });

    test('preserves non-ignored query params for all resources from configured service', async () => {
        const request = await createTestRequest();
        await setupTestData(request);

        // Non-ignored params like family are preserved — family=NONEXISTENT returns 0 results
        let resp = await request.get('/4_0_0/Patient?family=NONEXISTENT').set({
            ...getPatientHeaders(),
            'origin-service': 'external-service'
        });
        expect(resp).toHaveResourceCount(0);

        // Create two observations
        resp = await request
            .post(`/4_0_0/Observation/${observation1Id}/$merge?validate=true`)
            .send([observation1Resource, observation2Resource])
            .set(getHeaders());
        expect(resp).toHaveMergeResponse([{ created: true }, { created: true }]);

        // Verify both observations exist
        resp = await request.get('/4_0_0/Observation').set(getHeaders());
        expect(resp).toHaveResourceCount(2);

        // Search Observation with _count=1 from configured service
        // _count is not in ignoredParams, so it should be preserved
        resp = await request.get('/4_0_0/Observation?_count=1').set({
            ...getHeaders(),
            'origin-service': 'external-service'
        });

        // _count=1 is preserved, so only 1 observation returned
        expect(resp).toHaveResourceCount(1);
    });

    test('test fullUrl on entries for external service and non-external service requests', async () => {
        const originalStreamResults = process.env.STREAM_RESPONSE;
        process.env.STREAM_RESPONSE = 'false'; // Disable streaming to enable testing of fullUrl

        const request = await createTestRequest();
        await setupTestData(request);
        // Create observations
        let resp = await request
            .post(`/4_0_0/Observation/${observation1Id}/$merge?validate=true`)
            .send([observation1Resource, observation2Resource])
            .set(getHeaders());
        expect(resp).toHaveMergeResponse([{ created: true }, { created: true }]);

        // Patient search from external service — fullUrl should use URL prefix
        resp = await request.get('/4_0_0/Patient').set({
            ...getPatientHeaders(),
            'origin-service': 'external-service'
        });

        expect(resp).toHaveStatusCode(200);
        expect(resp.body.entry).toBeDefined();
        expect(resp.body.entry.length).toBeGreaterThan(0);
        // Every entry fullUrl should have URL prefix, no protocol/host, no base_version
        for (const entry of resp.body.entry) {
            expect(entry.fullUrl).toStartWith('http://example.com/Patient/');
        }

        // No origin-service header — should produce absolute URLs with default base URL
        resp = await request.get('/4_0_0/Patient').set(getPatientHeaders());

        expect(resp).toHaveStatusCode(200);
        expect(resp).toHaveResourceCount(3);

        // self link should be absolute
        const selfLink = resp.body.link.find((l) => l.relation === 'self');
        expect(selfLink).toBeDefined();
        expect(selfLink.url).toContain('://');
        expect(selfLink.url).toContain('4_0_0');

        // entry fullUrls should be absolute
        for (const entry of resp.body.entry) {
            expect(entry.fullUrl).toContain('://');
            expect(entry.fullUrl).toContain('4_0_0');
        }

        // Search observations from configured external service
        // externalReqUrlPrefix applies to all resources, so Observation also gets prefixed URLs
        resp = await request.get('/4_0_0/Observation').set({
            ...getHeaders(),
            'origin-service': 'external-service'
        });
        expect(resp).toHaveStatusCode(200);
        expect(resp.body.entry).toBeDefined();
        // fullUrls should have URL prefix since externalReqUrlPrefix applies to all resources
        for (const entry of resp.body.entry) {
            expect(entry.fullUrl).toStartWith('http://example.com/Observation/');
        }

        process.env.STREAM_RESPONSE = originalStreamResults; // Restore original value
    });
});
