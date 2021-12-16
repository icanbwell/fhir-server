const supertest = require('supertest');

const {app} = require('../../../app');
// provider file
const observation1Resource = require('./fixtures/observation/observation1.json');

// expected
const expectedObservationResources = require('./fixtures/expected/expected_observation.json');

const request = supertest(app);
const {commonBeforeEach, commonAfterEach, getHeaders} = require('../../common');

describe('ObservationReturnIdTests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('Observation Search By token Tests', () => {
        test('search by single token works', async () => {
            let resp = await request
                .get('/4_0_0/Observation')
                .set(getHeaders())
                .expect(200);

            expect(resp.body.length).toBe(0);
            console.log('------- response 1 ------------');
            console.log(JSON.stringify(resp.body, null, 2));
            console.log('------- end response 1 ------------');

            resp = await request
                .post('/4_0_0/Observation/1/$merge?validate=true')
                .send(observation1Resource)
                .set(getHeaders())
                .expect(200);

            console.log('------- response observation1Resource ------------');
            console.log(JSON.stringify(resp.body, null, 2));
            console.log('------- end response  ------------');
            expect(resp.body['created']).toBe(true);

            resp = await request
                .get('/4_0_0/Observation')
                .set(getHeaders())
                .expect(200);

            console.log('------- response 3 ------------');
            console.log(JSON.stringify(resp.body, null, 2));
            console.log('------- end response 3 ------------');

            resp = await request
                .get('/4_0_0/Observation/2354-InAgeCohort')
                .set(getHeaders())
                .expect(200);

            console.log('------- response Observation sorted ------------');
            console.log(JSON.stringify(resp.body, null, 2));
            console.log('------- end response sort ------------');
            // clear out the lastUpdated column since that changes
            let body = resp.body;
            delete body['meta']['lastUpdated'];

            let expected = expectedObservationResources[0];
            delete expected['meta']['lastUpdated'];
            delete expected['$schema'];

            expect(body).toStrictEqual(expected);
        });
    });
});
