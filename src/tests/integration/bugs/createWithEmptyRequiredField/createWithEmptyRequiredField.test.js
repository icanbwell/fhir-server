// test file
const explanationofbenefit1Resource = require('./fixtures/ExplanationOfBenefit/explanationofbenefit1.json');

const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    createTestRequest
} = require('../../common');
const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');
const deepcopy = require('deepcopy');

describe('Create Tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    test('create with missing/invalid required field should give error', async () => {
        const request = await createTestRequest();
        // ARRANGE
        // add the resources to FHIR server
        let resp = await request
            .post('/4_0_0/ExplanationOfBenefit')
            .send(explanationofbenefit1Resource)
            .set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveStatusCode(400);
        expect(resp.body).toStrictEqual({
            resourceType: 'OperationOutcome',
            issue: [
                {
                    severity: 'error',
                    code: 'invalid',
                    details: {
                        text: '/4_0_0/ExplanationOfBenefit should NOT have fewer than 1 items :{"limit":1}: at position .insurance'
                    }
                },
                {
                    severity: 'error',
                    code: 'invalid',
                    details: {
                        text: '/4_0_0/ExplanationOfBenefit should match exactly one schema in oneOf :{"passingSchemas":null}: at position root'
                    }
                }
            ]
        });

        let explanationofbenefit1ResourceWithoutInsurance = deepcopy(explanationofbenefit1Resource);
        delete explanationofbenefit1ResourceWithoutInsurance.insurance;
        resp = await request
            .post('/4_0_0/ExplanationOfBenefit')
            .send(explanationofbenefit1ResourceWithoutInsurance)
            .set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveStatusCode(400);
        expect(resp.body).toStrictEqual({
            resourceType: 'OperationOutcome',
            issue: [
                {
                    severity: 'error',
                    code: 'invalid',
                    details: {
                        text: '/4_0_0/ExplanationOfBenefit should have required property \'insurance\' :{"missingProperty":"insurance"}: at position root'
                    }
                },
                {
                    severity: 'error',
                    code: 'invalid',
                    details: {
                        text: '/4_0_0/ExplanationOfBenefit should match exactly one schema in oneOf :{"passingSchemas":null}: at position root'
                    }
                }
            ]
        });

        let explanationofbenefit1ResourceInvalidInsurance = deepcopy(explanationofbenefit1Resource);
        explanationofbenefit1ResourceInvalidInsurance.insurance = [null];
        resp = await request
            .post('/4_0_0/ExplanationOfBenefit')
            .send(explanationofbenefit1ResourceInvalidInsurance)
            .set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveStatusCode(400);
        expect(resp.body).toStrictEqual({
            resourceType: 'OperationOutcome',
            issue: [
                {
                    severity: 'error',
                    code: 'invalid',
                    details: {
                        text: '/4_0_0/ExplanationOfBenefit should be object :{"type":"object"}: at position .insurance[0]'
                    }
                },
                {
                    severity: 'error',
                    code: 'invalid',
                    details: {
                        text: '/4_0_0/ExplanationOfBenefit should match exactly one schema in oneOf :{"passingSchemas":null}: at position root'
                    }
                }
            ]
        });

        explanationofbenefit1ResourceInvalidInsurance.insurance = [''];
        resp = await request
            .post('/4_0_0/ExplanationOfBenefit')
            .send(explanationofbenefit1ResourceInvalidInsurance)
            .set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveStatusCode(400);
        expect(resp.body).toStrictEqual({
            resourceType: 'OperationOutcome',
            issue: [
                {
                    severity: 'error',
                    code: 'invalid',
                    details: {
                        text: '/4_0_0/ExplanationOfBenefit should be object :{"type":"object"}: at position .insurance[0]'
                    }
                },
                {
                    severity: 'error',
                    code: 'invalid',
                    details: {
                        text: '/4_0_0/ExplanationOfBenefit should match exactly one schema in oneOf :{"passingSchemas":null}: at position root'
                    }
                }
            ]
        });
    });
});
