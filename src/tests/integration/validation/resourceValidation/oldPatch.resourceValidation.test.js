process.env.ENABLE_PATCH_FAST_SERIALIZER = '0';

const validObservation = require('./fixtures/Observation/validObservation.json');
const expectedPatchAdditionalPropertyDropped = require('./fixtures/expectedPatch/oldPatchAdditionalPropertyDropped.json');

const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    getHeadersJsonPatch,
    createTestRequest,
    getTestContainer
} = require('../../common');
const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');

describe('Resource Validation Tests (PATCH fast serializer disabled)', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    test('patching in an unknown property is silently dropped (no error)', async () => {
        const request = await createTestRequest();
        expect(getTestContainer().patchOperation.useFastSerializer).toStrictEqual(false);

        const seedResp = await request
            .post('/4_0_0/Observation/$merge')
            .send(validObservation)
            .set(getHeaders());
        expect(seedResp).toHaveMergeResponse({ created: true });

        const resp = await request
            .patch('/4_0_0/Observation/observation-validation-test')
            .send([{ op: 'add', path: '/notAFhirField', value: 'some value' }])
            .set(getHeadersJsonPatch());

        expect(resp).toHaveStatusCode(200);
        expect(resp).toHaveResponse(expectedPatchAdditionalPropertyDropped);
    });
});
