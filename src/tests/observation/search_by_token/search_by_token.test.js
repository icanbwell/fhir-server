const supertest = require('supertest');

const {app} = require('../../../app');
// provider file
const observation1Resource = require('./fixtures/observation/observation1.json');
const observation2Resource = require('./fixtures/observation/observation2.json');

// expected
const expectedObservationResources = require('./fixtures/expected/expected_observation.json');

const request = supertest(app);
const {commonBeforeEach, commonAfterEach, getHeaders} = require('../../common');
const {compareBundles} = require('../../compareBundles');

describe('ObservationReturnIdTests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('Observation Search By token Tests', () => {
        test('search by single token works', async () => {
            // ARRANGE
            // add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/Observation/1/$merge?validate=true')
                .send(observation1Resource)
                .set(getHeaders())
                .expect(200);

            console.log('------- response from adding observation1Resource ------------');
            console.log(JSON.stringify(resp.body, null, 2));
            console.log('------- end response  ------------');
            expect(resp.body['created']).toBe(true);

            resp = await request
                .post('/4_0_0/Observation/1/$merge?validate=true')
                .send(observation2Resource)
                .set(getHeaders())
                .expect(200);

            console.log('------- response from adding observation2Resource ------------');
            console.log(JSON.stringify(resp.body, null, 2));
            console.log('------- end response  ------------');
            expect(resp.body['created']).toBe(true);

            // ACT & ASSERT
            // search by token system and code and make sure we get the right observation back
            resp = await request
                .get('/4_0_0/Observation/?token=http://www.icanbwell.com/cql/library|BMI001&_setIndexHint=1&_debug=1&_bundle=1')
                .set(getHeaders())
                .expect(200);

            console.log('------- response Observation sorted ------------');
            console.log(JSON.stringify(resp.body, null, 2));
            console.log('------- end response sort ------------');
            compareBundles(resp.body, expectedObservationResources);
        });
    });
});
