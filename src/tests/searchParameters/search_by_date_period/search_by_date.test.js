const supertest = require('supertest');

const {app} = require('../../../app');
// test file
const encounter1Resource = require('./fixtures/Encounter/Encounter1.json');
const encounter2Resource = require('./fixtures/Encounter/Encounter2.json');

// expected
const expectedEncounter = require('./fixtures/expected/expected_Encounter1.json');

const request = supertest(app);
const {commonBeforeEach, commonAfterEach, getHeaders} = require('../../common');
const {assertCompareBundles, assertMergeIsSuccessful} = require('../../fhirAsserts');

describe('Encounter Tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('Encounter search_by_code_text Tests', () => {
        test('search_by_date works', async () => {
            // ARRANGE
            // add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/Encounter/1/$merge?validate=true')
                .send(encounter1Resource)
                .set(getHeaders())
                .expect(200);
            assertMergeIsSuccessful(resp.body);

            resp = await request
                .post('/4_0_0/Encounter/2/$merge?validate=true')
                .send(encounter2Resource)
                .set(getHeaders())
                .expect(200);
            assertMergeIsSuccessful(resp.body);

            // ACT & ASSERT
            // search by token system and code and make sure we get the right Medication back
            resp = await request
                .get('/4_0_0/Encounter/?_bundle=1&source=https://thedacare.org&_security=https://www.icanbwell.com/access%7CThedacare&_lastUpdated=gt2022-03-01T00:00:00Z')
                .set(getHeaders())
                .expect(200);
            assertCompareBundles(resp.body, expectedEncounter);
        });
    });
});
