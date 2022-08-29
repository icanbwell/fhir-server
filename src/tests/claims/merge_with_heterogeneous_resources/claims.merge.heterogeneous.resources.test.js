const explanationOfBenefitBundleResource = require('./fixtures/explanation_of_benefits/explanation_of_benefits.json');
const expectedExplanationOfBenefitBundleResource = require('./fixtures/expected/expected_explanation_of_benefits.json');
const expectedMergeResponse = require('./fixtures/expected/expected_merge_response.json');
const expectedPatientBundleResource = require('./fixtures/expected/expected_patients.json');

const {commonBeforeEach, commonAfterEach, getHeaders, createTestRequest} = require('../../common');
const {describe, beforeEach, afterEach, expect} = require('@jest/globals');
const {assertCompareBundles} = require('../../fhirAsserts');

describe('Claim Merge Tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('Claim Merge Bundles', () => {
        test('Claims with heterogeneous resources merge properly', async () => {
            const request = await createTestRequest();
            let resp = await request
                .get('/4_0_0/ExplanationOfBenefit')
                .set(getHeaders())
                .expect(200);
            expect(resp.body.length).toBe(0);
            console.log('------- response 1 ------------');
            console.log(JSON.stringify(resp.body, null, 2));
            console.log('------- end response 1 ------------');

            resp = await request
                .post('/4_0_0/ExplanationOfBenefit/1/$merge')
                .send(explanationOfBenefitBundleResource)
                .set(getHeaders())
                .expect(200);
            let body = resp.body;
            console.log('------- response 2 ------------');
            console.log(JSON.stringify(resp.body, null, 2));
            console.log('------- end response 2  ------------');
            expect(body).toStrictEqual(expectedMergeResponse);

            resp = await request
                .get('/4_0_0/ExplanationOfBenefit?_bundle=1')
                .set(getHeaders())
                .expect(200);

            // clear out the lastUpdated column since that changes
            console.log('------- response 5 ------------');
            console.log(JSON.stringify(resp.body, null, 2));
            console.log('------- end response 5  ------------');
            assertCompareBundles({
                body: resp.body, expected: expectedExplanationOfBenefitBundleResource
            });

            resp = await request
                .get('/4_0_0/Patient?_bundle=1')
                .set(getHeaders())
                .expect(200);

            // clear out the lastUpdated column since that changes
            console.log('------- response 6 ------------');
            console.log(JSON.stringify(resp.body, null, 2));
            console.log('------- end response 6  ------------');
            assertCompareBundles({
                body: resp.body, expected: expectedPatientBundleResource});
        });
    });
});
