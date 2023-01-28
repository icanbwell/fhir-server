// test file
const person1Resource = require('./fixtures/Person/person1.json');

// expected
const expectedPersonResources = require('./fixtures/expected/expected_person.json');
const patch1 = require('./fixtures/patches/patch1.json');

const {commonBeforeEach, commonAfterEach, getHeaders, createTestRequest, getHeadersJsonPatch} = require('../../common');
const {describe, beforeEach, afterEach, test} = require('@jest/globals');

describe('Person Tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('Person patch Tests', () => {
        test('patch works', async () => {
            const request = await createTestRequest();
            // ARRANGE
            // add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/Person/1/$merge?validate=true')
                .send(person1Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            // ACT & ASSERT
            resp = await request
                .patch('/4_0_0/Person/7d744c63-fa81-45e9-bcb4-f312940e9300')
                .send(patch1)
                .set(getHeadersJsonPatch());

            resp = await request
                .get('/4_0_0/Person/7d744c63-fa81-45e9-bcb4-f312940e9300')
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedPersonResources);
        });
        test('patch fails with wrong content-type', async () => {
            const request = await createTestRequest();
            // ARRANGE
            // add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/Person/1/$merge?validate=true')
                .send(person1Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            // ACT & ASSERT
            resp = await request
                .patch('/4_0_0/Person/7d744c63-fa81-45e9-bcb4-f312940e9300')
                .send(patch1)
                .set(getHeaders());
            expect(resp.body).toStrictEqual({
                'resourceType': 'OperationOutcome',
                'issue': [
                    {
                        'severity': 'error',
                        'code': 'invalid',
                        'details': {
                            'text': 'Content-Type application/fhir+json is not supported for patch. Only application/json-patch+json is supported.'
                        },
                        'diagnostics': 'Content-Type application/fhir+json is not supported for patch. Only application/json-patch+json is supported.'
                    }
                ]
            });
        });
    });
});
