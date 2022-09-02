// provider file
const patient1Resource = require('./fixtures/patient/patient1.json');

// expected
const expectedSinglePatientResource = require('./fixtures/expected/expected_single_patient.json');

const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    createTestRequest,
} = require('../../common');
const {describe, beforeEach, afterEach} = require('@jest/globals');
const {
    expectResponse, expectMergeResponse, expectResourceCount,
} = require('../../fhirAsserts');

describe('Merge By Parameters Tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('Merge By Parameters Tests', () => {
        test('merge by parameters works', async () => {
            const request = await createTestRequest();
            let resp = await request
                .get('/4_0_0/Patient')
                .set(getHeaders());
            expectResourceCount(resp, 0);

            /**
             * http://www.hl7.org/fhir/parameters-example.json.html
             * @type {{parameter: [{resource: {resourceType: string, id: string, meta: {security: {}}, identifier: {}, active: boolean, name: {}, telecom: {}, address: {}, gender: string}, name: string}], resourceType: string}}
             */
            const parametersResource = {
                resourceType: 'Parameters',
                parameter: [{name: 'resource', resource: patient1Resource}],
            };

            resp = await request
                .post('/4_0_0/Patient/1679033641/$merge')
                .send(parametersResource)
                .set(getHeaders());
            expectMergeResponse(resp, [{created: true}]);

            resp = await request
                .get('/4_0_0/Patient')
                .set(getHeaders());
            expectResourceCount(resp, 1);

            resp = await request
                .get('/4_0_0/Patient/00100000000')
                .set(getHeaders());
            expectResponse({resp, expected: expectedSinglePatientResource});
        });
    });
});
