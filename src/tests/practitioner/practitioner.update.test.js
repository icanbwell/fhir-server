const practitionerResource = require('./fixtures/providers/practitioner.json');
const expectedPractitionerResource = require('./fixtures/providers/expected_practitioner.json');

const { commonBeforeEach, commonAfterEach, getHeaders, createTestRequest } = require('../common');
const { describe, beforeEach, afterEach, expect } = require('@jest/globals');

describe('Practitioner Update Tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('Practitioner Merges', () => {
        test('Multiple calls to Practitioner update properly', async () => {
            const request = await createTestRequest();
            let resp = await request.get('/4_0_0/Practitioner').set(getHeaders()).expect(200);
            expect(resp.body.length).toBe(0);
            console.log('------- response 1 ------------');
            console.log(JSON.stringify(resp.body, null, 2));
            console.log('------- end response 1 ------------');
            resp = await request
                .put('/4_0_0/Practitioner/4657')
                .send(practitionerResource)
                .set(getHeaders())
                .expect(201);
            console.log('------- response 2 ------------');
            console.log(JSON.stringify(resp.body, null, 2));
            console.log('------- end response 2  ------------');
            resp = await request
                .put('/4_0_0/Practitioner/4657')
                .send(practitionerResource)
                .set(getHeaders())
                .expect(200);
            console.log('------- response 2 ------------');
            console.log(JSON.stringify(resp.body, null, 2));
            console.log('------- end response 2  ------------');
            resp = await request.get('/4_0_0/Practitioner').set(getHeaders()).expect(200);
            // clear out the lastUpdated column since that changes
            let body = resp.body;
            expect(body.length).toBe(1);
            delete body[0]['meta']['lastUpdated'];
            let expected = expectedPractitionerResource;
            delete expected[0]['meta']['lastUpdated'];
            expect(body).toStrictEqual(expected);
            console.log('------- response 5 ------------');
            console.log(JSON.stringify(resp.body, null, 2));
            console.log('------- end response 5  ------------');
        });
    });
});
