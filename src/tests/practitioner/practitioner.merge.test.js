/* eslint-disable no-unused-vars */
const supertest = require('supertest');

const {app} = require('../../app');
const practitionerResource = require('./fixtures/providers/practitioner.json');
const practitionerResourcev2 = require('./fixtures/providers/practitioner_v2.json');
const expectedPractitionerResource_v2 = require('./fixtures/providers/expected_practitioner_v2.json');

const request = supertest(app);
const {commonBeforeEach, commonAfterEach, getHeaders} = require('../common');

describe('Practitioner Merge Tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('Practitioner Merges', () => {
        test('Multiple calls to Practitioner merge properly', async () => {
            let resp = await request
                .get('/4_0_0/Practitioner')
                .set(getHeaders())
                .expect(200);
            expect(resp.body.length).toBe(0);
            console.log('------- response 1 ------------');
            console.log(JSON.stringify(resp.body, null, 2));
            console.log('------- end response 1 ------------');

            resp = await request
                .post('/4_0_0/Practitioner/4657/$merge')
                .send(practitionerResource)
                .set(getHeaders())
                .expect(200);

            console.log('------- response 2 ------------');
            console.log(JSON.stringify(resp.body, null, 2));
            console.log('------- end response 2  ------------');

            resp = await request
                .post('/4_0_0/Practitioner/4657/$merge')
                .send(practitionerResource)
                .set(getHeaders())
                .expect(200);

            console.log('------- response 3 ------------');
            console.log(JSON.stringify(resp.body, null, 2));
            console.log('------- end response 3  ------------');

            resp = await request
                .post('/4_0_0/Practitioner/4657/$merge')
                .send(practitionerResourcev2)
                .set(getHeaders())
                .expect(200);

            console.log('------- response 3 ------------');
            console.log(JSON.stringify(resp.body, null, 2));
            console.log('------- end response 3  ------------');

            resp = await request
                .get('/4_0_0/Practitioner')
                .set(getHeaders())
                .expect(200);

            // clear out the lastUpdated column since that changes
            let body = resp.body;
            console.log('------- response 5 ------------');
            console.log(JSON.stringify(resp.body, null, 2));
            console.log('------- end response 5  ------------');
            expect(body.length).toBe(1);
            delete body[0]['meta']['lastUpdated'];
            let expected = expectedPractitionerResource_v2;
            delete expected[0]['meta']['lastUpdated'];
            expected[0]['meta']['versionId'] = '2';
            expect(body).toStrictEqual(expected);
        });
    });
});
