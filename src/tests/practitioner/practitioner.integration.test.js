const practitionerResource = require('./fixtures/providers/practitioner.json');
const locationResource = require('./fixtures/providers/location.json');
const practitionerRoleResource = require('./fixtures/providers/practitioner_role.json');
const expectedPractitionerResource = require('./fixtures/providers/expected_practitioner.json');

const { commonBeforeEach, commonAfterEach, getHeaders, createTestRequest } = require('../common');
const { describe, beforeEach, afterEach, expect } = require('@jest/globals');
const { assertStatusCode } = require('../fhirAsserts');

describe('Practitioner Integration Tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('Practitioner Integration Tests', () => {
        test('Provider Files Loads', async () => {
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
                .post('/4_0_0/PractitionerRole')
                .send(practitionerRoleResource)
                .set(getHeaders())
                .expect(assertStatusCode(201));
            console.log('------- response 3 ------------');
            console.log(JSON.stringify(resp.body, null, 2));
            console.log('------- end response 3  ------------');
            resp = await request
                .post('/4_0_0/Location')
                .send(locationResource)
                .set(getHeaders())
                .expect(201);
            console.log('------- response 4 ------------');
            console.log(JSON.stringify(resp.body, null, 2));
            console.log('------- end response 4  ------------');
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
