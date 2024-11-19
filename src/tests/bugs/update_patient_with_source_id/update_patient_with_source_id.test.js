// test file
const patient1Resource = require('./fixtures/Patient/patient1.json');

const expectedResponse1 = require('./fixtures/expected/expected_response1.json');
const expectedResponse2 = require('./fixtures/expected/expected_response2.json');

const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    createTestRequest
} = require('../../common');
const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');

describe('Patient with source id update test', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });
    test('should not raise error in put request when uuid in path param', async () => {
        const request = await createTestRequest();
        // ARRANGE
        // add the resources to FHIR server
        resp = await request
            .post('/4_0_0/Patient/1/$merge?validate=true')
            .send(patient1Resource)
            .set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMergeResponse({ created: true });

        let uuid = resp.body.uuid;
        patient1Resource.birthDate = '2017-01-02';

        resp = await request
            .put('/4_0_0/Patient/' + uuid)
            .send(patient1Resource)
            .set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveResponse(expectedResponse1);

        patient1Resource.birthDate = '2017-01-01';
        resp = await request
            .put('/4_0_0/Patient/patient1')
            .send(patient1Resource)
            .set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveResponse(expectedResponse2);
    });
});
