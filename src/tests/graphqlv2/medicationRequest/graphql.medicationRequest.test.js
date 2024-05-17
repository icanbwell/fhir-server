const expectedGraphQlResponse = require('./fixtures/expected_graphql_response.json');
const expectedGraphQlFilterByCodeResponse = require('./fixtures/expected_graphql_filter_by_code_response.json');
const patientBundleResource = require('./fixtures/patients.json');
const medicationRequestBundleResource = require('./fixtures/medication_requests.json');
const medicationDispenseBundleResource = require('./fixtures/medication_dispenses.json');

const fs = require('fs');
const path = require('path');

const query = fs.readFileSync(path.resolve(__dirname, './fixtures/query.graphql'), 'utf8');
const queryFilterByCode = fs.readFileSync(path.resolve(__dirname, './fixtures/queryFilterByCode.graphql'), 'utf8');

const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    getGraphQLHeaders,
    createTestRequest
} = require('../../common');
const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');

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
            let resp = await request.get('/4_0_0/MedicationRequest').set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResourceCount(0);

            resp = await request
                .post('/4_0_0/Patient/$merge')
                .send(patientBundleResource)
                .set(getHeaders());

            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse([{ created: true }]);

            resp = await request
                .post('/4_0_0/MedicationRequest/$merge')
                .send(medicationRequestBundleResource)
                .set(getHeaders());

            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse([{ created: true }]);

            resp = await request
                .post('/4_0_0/MedicationDispense/$merge')
                .send(medicationDispenseBundleResource)
                .set(getHeaders());

            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse([{ created: true }]);

            resp = await request
                .post('/4_0_0/$graphqlv2')
                .send({
                    operationName: null,
                    variables: {},
                    query: graphqlQueryText
                })
                .set(getGraphQLHeaders())
                .expect(200);
            const body = resp.body;
            if (body.errors) {
                expect(body.errors).toBeUndefined();
            }
            expect(resp).toHaveResponse(expectedGraphQlResponse, r => {
                return r;
            });
        });
        test('GraphQL get MedicationRequest filter by code', async () => {
            const request = await createTestRequest();
            const graphqlQueryText = queryFilterByCode.replace(/\\n/g, '');
            let resp = await request.get('/4_0_0/MedicationRequest').set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResourceCount(0);

            resp = await request
                .post('/4_0_0/Patient/$merge')
                .send(patientBundleResource)
                .set(getHeaders());

            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse([{ created: true }]);

            resp = await request
                .post('/4_0_0/MedicationRequest/$merge')
                .send(medicationRequestBundleResource)
                .set(getHeaders());

            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse([{ created: true }]);

            resp = await request
                .post('/4_0_0/MedicationDispense/$merge')
                .send(medicationDispenseBundleResource)
                .set(getHeaders());

            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse([{ created: true }]);

            resp = await request
                .post('/4_0_0/$graphqlv2')
                .send({
                    operationName: null,
                    variables: {},
                    query: graphqlQueryText
                })
                .set(getGraphQLHeaders())
                .expect(200);
            const body = resp.body;
            if (body.errors) {
                expect(body.errors).toBeUndefined();
            }
            expect(resp).toHaveResponse(expectedGraphQlFilterByCodeResponse, r => {
                return r;
            });
        });
    });
});
