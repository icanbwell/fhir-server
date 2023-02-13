const allergyIntoleranceBundleResource = require('./fixtures/allergy_intolerances.json');
const expectedAllergyIntoleranceBundleResource = require('./fixtures/expected_allergy_intolerances.json');

const patientBundleResource = require('./fixtures/patients.json');

const fs = require('fs');
const path = require('path');

// eslint-disable-next-line security/detect-non-literal-fs-filename
const allergyIntoleranceQuery = fs.readFileSync(
    path.resolve(__dirname, './fixtures/query.graphql'),
    'utf8'
);

const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    getGraphQLHeaders,
    createTestRequest,
} = require('../../common');
const { describe, beforeEach, afterEach, expect, test } = require('@jest/globals');
const {logInfo} = require('../../../operations/common/logging');

describe('GraphQL AllergyIntolerance Tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('GraphQL AllergyIntolerance', () => {
        test('GraphQL AllergyIntolerance properly', async () => {
            const request = await createTestRequest();
            const graphqlQueryText = allergyIntoleranceQuery.replace(/\\n/g, '');
            let resp = await request.get('/4_0_0/AllergyIntolerance').set(getHeaders()).expect(200);
            expect(resp.body.length).toBe(0);
            logInfo('------- response 1 ------------');
            logInfo('', {'resp': resp.body});
            logInfo('------- end response 1 ------------');

            resp = await request
                .post('/4_0_0/Patient/1/$merge')
                .send(patientBundleResource)
                .set(getHeaders())
                .expect(200);
            logInfo('------- response 2 ------------');
            logInfo('', {'resp': resp.body});
            logInfo('------- end response 2  ------------');

            resp = await request
                .post('/4_0_0/AllergyIntolerance/1/$merge')
                .send(allergyIntoleranceBundleResource)
                .set(getHeaders())
                .expect(200);
            logInfo('------- response 2 ------------');
            logInfo('', {'resp': resp.body});
            logInfo('------- end response 2  ------------');

            resp = await request.get('/4_0_0/Patient/').set(getHeaders()).expect(200);
            logInfo('------- response patient ------------');
            logInfo('', {'resp': resp.body});
            logInfo('------- end response patient  ------------');
            resp = await request.get('/4_0_0/AllergyIntolerance/').set(getHeaders()).expect(200);
            logInfo('------- response 2 ------------');
            logInfo('', {'resp': resp.body});
            logInfo('------- end response 2  ------------');

            resp = await request
                // .get('/graphql/?query=' + graphqlQueryText)
                // .set(getHeaders())
                .post('/graphqlv2')
                .send({
                    operationName: null,
                    variables: {},
                    query: graphqlQueryText,
                })
                .set(getGraphQLHeaders())
                .expect(200);
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedAllergyIntoleranceBundleResource);
        });
    });
});
