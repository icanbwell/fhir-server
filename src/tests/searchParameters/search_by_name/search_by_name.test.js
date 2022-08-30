// test file
const person1Resource = require('./fixtures/Person/person1.json');
const person2Resource = require('./fixtures/Person/person2.json');
const person3Resource = require('./fixtures/Person/person3.json');
const person4Resource = require('./fixtures/Person/person4.json');
const person5Resource = require('./fixtures/Person/person5.json');
const person6Resource = require('./fixtures/Person/person6.json');
const person7Resource = require('./fixtures/Person/person7.json');
const person8Resource = require('./fixtures/Person/person8.json');
const person9Resource = require('./fixtures/Person/person9.json');
const person10Resource = require('./fixtures/Person/person10.json');
const person11Resource = require('./fixtures/Person/person11.json');

// expected
const expectedPersonResources = require('./fixtures/expected/expected_Person.json');

const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    createTestRequest,
} = require('../../common');
const { describe, beforeEach, afterEach } = require('@jest/globals');
const { assertCompareBundles, assertMergeIsSuccessful } = require('../../fhirAsserts');

describe('Person Tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('Person search_by_name Tests', () => {
        test('search_by_name works', async () => {
            const request = await createTestRequest();
            // ARRANGE
            // add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/Person/1/$merge?validate=true')
                .send(person1Resource)
                .set(getHeaders())
                .expect(200);
            assertMergeIsSuccessful(resp.body);

            resp = await request
                .post('/4_0_0/Person/2/$merge?validate=true')
                .send(person2Resource)
                .set(getHeaders())
                .expect(200);
            assertMergeIsSuccessful(resp.body);

            resp = await request
                .post('/4_0_0/Person/3/$merge?validate=true')
                .send(person3Resource)
                .set(getHeaders())
                .expect(200);
            assertMergeIsSuccessful(resp.body);

            resp = await request
                .post('/4_0_0/Person/4/$merge?validate=true')
                .send(person4Resource)
                .set(getHeaders())
                .expect(200);
            assertMergeIsSuccessful(resp.body);

            resp = await request
                .post('/4_0_0/Person/5/$merge?validate=true')
                .send(person5Resource)
                .set(getHeaders())
                .expect(200);
            assertMergeIsSuccessful(resp.body);

            resp = await request
                .post('/4_0_0/Person/6/$merge?validate=true')
                .send(person6Resource)
                .set(getHeaders())
                .expect(200);
            assertMergeIsSuccessful(resp.body);

            resp = await request
                .post('/4_0_0/Person/7/$merge?validate=true')
                .send(person7Resource)
                .set(getHeaders())
                .expect(200);
            assertMergeIsSuccessful(resp.body);

            resp = await request
                .post('/4_0_0/Person/8/$merge?validate=true')
                .send(person8Resource)
                .set(getHeaders())
                .expect(200);
            assertMergeIsSuccessful(resp.body);

            resp = await request
                .post('/4_0_0/Person/9/$merge?validate=true')
                .send(person9Resource)
                .set(getHeaders())
                .expect(200);
            assertMergeIsSuccessful(resp.body);

            resp = await request
                .post('/4_0_0/Person/10/$merge?validate=true')
                .send(person10Resource)
                .set(getHeaders())
                .expect(200);
            assertMergeIsSuccessful(resp.body);

            resp = await request
                .post('/4_0_0/Person/11/$merge?validate=true')
                .send(person11Resource)
                .set(getHeaders())
                .expect(200);
            assertMergeIsSuccessful(resp.body);

            // ACT & ASSERT
            // search by token system and code and make sure we get the right Medication back
            resp = await request
                .get('/4_0_0/Person?name=singhal&_bundle=1&')
                .set(getHeaders())
                .expect(200);
            assertCompareBundles({
                body: resp.body,
                expected: expectedPersonResources,
            });
        });
    });
});
