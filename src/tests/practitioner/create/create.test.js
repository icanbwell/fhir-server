// test file
const practitioner1Resource = require('./fixtures/Practitioner/practitioner1.json');

// expected
const expectedPractitionerResources = require('./fixtures/expected/expected_Practitioner.json');

const {commonBeforeEach, commonAfterEach, getHeaders, createTestRequest} = require('../../common');
const {describe, beforeEach, afterEach} = require('@jest/globals');
const {assertStatusCode, assertResponse} = require('../../fhirAsserts');

describe('Practitioner Tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('Practitioner create Tests', () => {
        test('create works', async () => {
            const request = await createTestRequest();
            // ARRANGE
            // add the resources to FHIR server
            await request
                .post('/4_0_0/Practitioner/')
                .send(practitioner1Resource)
                .set(getHeaders())
                .expect(assertStatusCode(201));

            practitioner1Resource['active'] = false;

            await request
                .post('/4_0_0/Practitioner')
                .send(practitioner1Resource)
                .set(getHeaders())
                .expect(assertStatusCode(201));

            // ACT & ASSERT
            // search by token system and code and make sure we get the right Practitioner back
            await request
                .get('/4_0_0/Practitioner/?_bundle=1')
                .set(getHeaders())
                .expect(assertResponse(expectedPractitionerResources, (r) => {
                            delete r['id'];
                            return r;
                        }
                    )
                );
        });
    });
});
