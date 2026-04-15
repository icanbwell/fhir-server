// test file
const observationWithUnderscoreFields = require('./fixtures/Observation_with_underscore_fields.json');

const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    createTestRequest,
    getTestContainer,
    mockHttpContext
} = require('../../common');

const { describe, beforeEach, afterEach, test, expect, beforeAll, afterAll } = require('@jest/globals');
const deepcopy = require('deepcopy');

describe('Underscore Fields Merge Tests (Fast Merge Serializer)', () => {
    let requestId;
    let originalEnv;
    beforeAll(() => {
        originalEnv = process.env.ENABLE_MERGE_FAST_SERIALIZER;
        process.env.ENABLE_MERGE_FAST_SERIALIZER = '1';
    });

    afterAll(() => {
        process.env.ENABLE_MERGE_FAST_SERIALIZER = originalEnv;
    });

    beforeEach(async () => {
        await commonBeforeEach();
        requestId = mockHttpContext();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    test('Merge succeeds for resource with nested underscore fields and strips them from stored resource', async () => {
        const request = await createTestRequest();

        // Merge observation that has _system, _code, _display in nested objects
        let resp = await request
            .post('/4_0_0/Observation/1/$merge')
            .send(observationWithUnderscoreFields)
            .set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMergeResponse({ created: true });

        const container = getTestContainer();
        /**
         * @type {PostRequestProcessor}
         */
        const postRequestProcessor = container.postRequestProcessor;
        await postRequestProcessor.waitTillDoneAsync({ requestId });

        // Fetch the stored resource and verify underscore fields are stripped
        resp = await request
            .get('/4_0_0/Observation/?_bundle=1')
            .set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveResourceCount(1);

        const storedObservation = resp.body.entry[0].resource;

        // Nested underscore fields should be stripped
        expect(storedObservation.valueQuantity._system).toBeUndefined();
        expect(storedObservation.valueQuantity._code).toBeUndefined();
        expect(storedObservation.code.coding[0]._display).toBeUndefined();

        // Regular fields should still be present
        expect(storedObservation.valueQuantity.value).toBe(76);
        expect(storedObservation.code.coding[0].system).toBe('http://loinc.org');
        expect(storedObservation.code.coding[0].display).toBe('Blood pressure panel');
        expect(storedObservation.status).toBe('final');
    });

    test('Merge error response still contains _uuid and _sourceAssigningAuthority for debugging', async () => {
        const request = await createTestRequest();

        // Create a resource with underscore fields AND a schema validation error (invalid field)
        const invalidResource = deepcopy(observationWithUnderscoreFields);
        invalidResource[0].invalidField = 'this-should-fail-validation';

        const resp = await request
            .post('/4_0_0/Observation/1/$merge')
            .send(invalidResource)
            .set(getHeaders());

        expect(resp).toHaveStatusCode(200);

        // The response should contain uuid and sourceAssigningAuthority for debugging
        expect(resp.body[0].uuid).toBeDefined();
        expect(resp.body[0].sourceAssigningAuthority).toBeDefined();
        expect(resp.body[0].operationOutcome).toBeDefined();
        expect(resp.body[0].created).toBe(false);
        expect(resp.body[0].updated).toBe(false);
    });
});
