const supertest = require('supertest');

const {app} = require('../../../app');
// test file
const person1Resource = require('./fixtures/Person/Person1.json');
const person2Resource = require('./fixtures/Person/Person2.json');
const person3Resource = require('./fixtures/Person/Person3.json');
const person4Resource = require('./fixtures/Person/Person4.json');
const person5Resource = require('./fixtures/Person/Person5.json');
const person6Resource = require('./fixtures/Person/Person6.json');
const person7Resource = require('./fixtures/Person/Person7.json');
const person8Resource = require('./fixtures/Person/Person8.json');
const person9Resource = require('./fixtures/Person/Person9.json');
const person10Resource = require('./fixtures/Person/Person10.json');

// expected
const expectedPerson = require('./fixtures/expected/expected_Person1.json');

const request = supertest(app);
const {commonBeforeEach, commonAfterEach, getHeaders} = require('../../common');
const {assertCompareBundles, assertMergeIsSuccessful} = require('../../fhirAsserts');

describe('Name Tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('name search_by_name Tests', () => {
        test('search_by_name works', async () => {
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
            // ACT & ASSERT
            // search by token system and code and make sure we get the right Medication back
            resp = await request
                .get('/4_0_0/Person?_security=https://www.icanbwell.com/access%7Cbwell&name=Singhal')
                .set(getHeaders())
                .expect(200);
            assertCompareBundles(resp.body, expectedPerson);
        });
    });
});
