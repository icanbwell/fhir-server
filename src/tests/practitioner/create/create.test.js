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
            // const id1 = resp.headers['content-location'].split('/').splice(5, 1)[0];

            // pause enough so the lastUpdated time is later on the second resource so our sorting works properly
            await new Promise(resolve => setTimeout(resolve, 3000));
            await request
                .post('/4_0_0/Practitioner')
                .send(practitioner1Resource)
                .set(getHeaders())
                .expect(assertStatusCode(201));

            // const id2 = resp.headers['content-location'].split('/').splice(5, 1)[0];

            // ACT & ASSERT
            // search by token system and code and make sure we get the right Practitioner back
            await request
                .get('/4_0_0/Practitioner?_bundle=1&_sort=lastUpdated')
                .set(getHeaders())
                .expect(assertResponse({
                            expected: expectedPractitionerResources,
                            fnCleanResource: (r) => {
                                delete r['id'];
                                return r;
                            }
                        }
                    )
                );
        });
    });
});
