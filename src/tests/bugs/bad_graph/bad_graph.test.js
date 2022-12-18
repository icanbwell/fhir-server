const {commonBeforeEach, commonAfterEach, createTestRequest, getHeaders} = require('../../common');
const {describe, beforeEach, afterEach, test} = require('@jest/globals');
const graphResource = require('./fixtures/graph.json');
const expectedResponseResource = require('./fixtures/expected_response.json');

describe('Bad Graph Tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('Bad Graph Tests', () => {
        // noinspection JSUnresolvedFunction
        test('patient bad graph missing fails with 400 code', async () => {
            const request = await createTestRequest();
            // ARRANGE
            // add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/Patient/$graph?id=b5eea5f7-54ee-4a59-8ab3-003a7b4fbed2')
                .send(graphResource)
                .set(getHeaders());

            // expect(resp).toHaveStatusCode(400);

            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedResponseResource);
        });
    });
});
