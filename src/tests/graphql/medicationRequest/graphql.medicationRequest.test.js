const expectedGraphQlResponse = require('./fixtures/expected_graphql_response.json');
const patientBundleResource = require('./fixtures/patients.json');
const medicationRequestBundleResource = require('./fixtures/medication_requests.json');
const medicationDispenseBundleResource = require('./fixtures/medication_dispenses.json');

const fs = require('fs');
const path = require('path');

// eslint-disable-next-line security/detect-non-literal-fs-filename
const query = fs.readFileSync(path.resolve(__dirname, './fixtures/query.graphql'), 'utf8');

const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    getGraphQLHeaders,
    createTestRequest,
} = require('../../common');
const { describe, beforeEach, afterEach, expect, test } = require('@jest/globals');
const { logInfo, logError } = require('../../../operations/common/logging');

describe('GraphQL MedicationRequest Tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('GraphQL MedicationRequest', () => {
        test('GraphQL get MedicationRequest with dispenses', async () => {
            const request = await createTestRequest();
            const graphqlQueryText = query.replace(/\\n/g, '');
            let resp = await request.get('/4_0_0/MedicationRequest').set(getHeaders()).expect(200);
            expect(resp.body.length).toBe(0);
            logInfo('------- response 1 ------------');
            logInfo('', {'resp': resp.body});
            logInfo('------- end response 1 ------------');

            resp = await request
                .post('/4_0_0/Patient/$merge')
                .send(patientBundleResource)
                .set(getHeaders())
                .expect(200);
            logInfo('------- response 2 ------------');
            logInfo('', {'resp': resp.body});
            logInfo('------- end response 2  ------------');

            resp = await request
                .post('/4_0_0/MedicationRequest/$merge')
                .send(medicationRequestBundleResource)
                .set(getHeaders())
                .expect(200);
            logInfo('------- response 3 ------------');
            logInfo('', {'resp': resp.body});
            logInfo('------- end response 3 ------------');

            resp = await request
                .post('/4_0_0/MedicationDispense/$merge')
                .send(medicationDispenseBundleResource)
                .set(getHeaders())
                .expect(200);
            logInfo('------- response 4 ------------');
            logInfo('', {'resp': resp.body});
            logInfo('------- end response 4 ------------');
            resp = await request
                .post('/graphqlv2')
                .send({
                    operationName: null,
                    variables: {},
                    query: graphqlQueryText,
                })
                .set(getGraphQLHeaders())
                .expect(200);
            let body = resp.body;
            logInfo('------- response graphql ------------');
            logInfo('', {'resp': resp.body});
            logInfo('------- end response graphql  ------------');
            if (body.errors) {
                logError('', {'errors': body.errors});
                expect(body.errors).toBeUndefined();
            }
            expect(body.data.medicationRequest.entry).toStrictEqual(expectedGraphQlResponse);
        });
    });
});
