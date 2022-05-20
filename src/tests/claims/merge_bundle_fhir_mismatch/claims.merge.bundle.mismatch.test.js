/* eslint-disable no-unused-vars */
const supertest = require('supertest');

const {app} = require('../../../app');
const explanationOfBenefitBundleResource1 = require('./fixtures/explanation_of_benefits1.json');
const explanationOfBenefitBundleResource2 = require('./fixtures/explanation_of_benefits2.json');
const explanationOfBenefitBundleResource3 = require('./fixtures/explanation_of_benefits3.json');
const expectedExplanationOfBenefitBundleResource = require('./fixtures/expected_explanation_of_benefits.json');

const request = supertest(app);

const {commonBeforeEach, commonAfterEach, getHeaders} = require('../../common');
const {assertCompareBundles, assertMergeIsSuccessful} = require('../../fhirAsserts');

describe('Claim Merge Tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('Claim Merge with overlapping items', () => {
        test('Claims with same claim number in different bundles and similar items merge properly', async () => {
            let resp = await request
                .get('/4_0_0/ExplanationOfBenefit')
                .set(getHeaders());

            expect(resp.body.length).toBe(0);
            console.log('------- response 1 ------------');
            console.log(JSON.stringify(resp.body, null, 2));
            console.log('------- end response 1 ------------');

            resp = await request
                .post('/4_0_0/ExplanationOfBenefit/1/$merge')
                .send(explanationOfBenefitBundleResource1)
                .set(getHeaders());

            assertMergeIsSuccessful(resp.body);

            console.log('------- response 2 ------------');
            console.log(JSON.stringify(resp.body, null, 2));
            console.log('------- end response 2  ------------');

            resp = await request
                .post('/4_0_0/ExplanationOfBenefit/1/$merge')
                .send(explanationOfBenefitBundleResource2)
                .set(getHeaders());

            console.log('------- response 3 ------------');
            console.log(JSON.stringify(resp.body, null, 2));
            console.log('------- end response 3  ------------');


            resp = await request
                .post('/4_0_0/ExplanationOfBenefit/1/$merge')
                .send(explanationOfBenefitBundleResource3)
                .set(getHeaders());

            console.log('------- response 4 ------------');
            console.log(JSON.stringify(resp.body, null, 2));
            console.log('------- end response 4  ------------');

            resp = await request
                .get('/4_0_0/ExplanationOfBenefit?_bundle=1')
                .set(getHeaders());

            assertCompareBundles(resp.body, expectedExplanationOfBenefitBundleResource);
        });
    });
});
