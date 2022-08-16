const organizationResponseBundle1 = require('./fixtures/organization1.json');
const organizationResponseBundle2 = require('./fixtures/organization2.json');
const organizationResponseBundle3 = require('./fixtures/organization3.json');
const expectedOrganizationResponseBundle = require('./fixtures/expected_organization_responses.json');
const expectedOrganizationResponseBundle2 = require('./fixtures/expected_organization_responses_2.json');

const {commonBeforeEach, commonAfterEach, getHeaders, createTestRequest} = require('../../common');
const request = createTestRequest();
const {describe, beforeEach, afterEach, expect} = require('@jest/globals');

describe('Organization Response Tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('OrganizationResponse Bundles', () => {
        test('OrganizationResponse can search by null', async () => {
            let resp = await request
                .get('/4_0_0/Organization')
                .set(getHeaders())
                .expect(200);
            expect(resp.body.length).toBe(0);
            console.log('------- response 1 ------------');
            console.log(JSON.stringify(resp.body, null, 2));
            console.log('------- end response 1 ------------');
            resp = await request
                .post('/4_0_0/Organization/test1/$merge')
                .send(organizationResponseBundle1)
                .set(getHeaders())
                .expect(200);
            console.log('------- response 2 ------------');
            console.log(JSON.stringify(resp.body, null, 2));
            console.log('------- end response 2  ------------');
            resp = await request
                .post('/4_0_0/Organization/test2/$merge')
                .send(organizationResponseBundle2)
                .set(getHeaders())
                .expect(200);
            console.log('------- response 3 ------------');
            console.log(JSON.stringify(resp.body, null, 2));
            console.log('------- end response 3  ------------');
            resp = await request
                .post('/4_0_0/Organization/test3/$merge')
                .send(organizationResponseBundle3)
                .set(getHeaders())
                .expect(200);
            console.log('------- response 4 ------------');
            console.log(JSON.stringify(resp.body, null, 2));
            console.log('------- end response 4  ------------');
            resp = await request
                .get('/4_0_0/Organization?identifier:missing=true')
                .set(getHeaders())
                .expect(200);
            // clear out the lastUpdated column since that changes
            let body = resp.body;
            console.log('------- response 5 ------------');
            console.log(JSON.stringify(resp.body, null, 2));
            console.log('------- end response 5  ------------');
            expect(body.length).toBe(2);
            body.forEach(element => {
                delete element['meta']['lastUpdated'];
            });
            let expected = expectedOrganizationResponseBundle;
            expected.forEach(element => {
                if ('meta' in element) {
                    delete element['meta']['lastUpdated'];
                }
                // element['meta'] = {'versionId': '1'};
                if ('$schema' in element) {
                    delete element['$schema'];
                }
            });
            expect(body).toStrictEqual(expected);
            resp = await request
                .get('/4_0_0/Organization?identifier:missing=false')
                .set(getHeaders())
                .expect(200);
            // clear out the lastUpdated column since that changes
            body = resp.body;
            console.log('------- response 6 ------------');
            console.log(JSON.stringify(resp.body, null, 2));
            console.log('------- end response 6  ------------');
            expect(body.length).toBe(1);
            body.forEach(element => {
                delete element['meta']['lastUpdated'];
            });
            expected = expectedOrganizationResponseBundle2;
            expected.forEach(element => {
                if ('meta' in element) {
                    delete element['meta']['lastUpdated'];
                }
                if ('$schema' in element) {
                    delete element['$schema'];
                }
            });
            expect(body).toStrictEqual(expected);
        });
    });
});
