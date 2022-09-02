// practice
const practiceOrganizationResource = require('./fixtures/practice/practice_organization.json');
const practiceOrganizationResource2 = require('./fixtures/practice/practice_organization2.json');

// expected
const expectedOrganizationResource = require('./fixtures/expected/expected_organization.json');

const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    createTestRequest,
} = require('../../common');
const { describe, beforeEach, afterEach, expect } = require('@jest/globals');

describe('Organization Everything Tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('Everything Tests', () => {
        test('Everything works properly', async () => {
            const request = await createTestRequest();
            let resp = await request.get('/4_0_0/Organization').set(getHeaders()).expect(200);
            expect(resp.body.length).toBe(0);
            console.log('------- response 1 ------------');
            console.log(JSON.stringify(resp.body, null, 2));
            console.log('------- end response 1 ------------');

            resp = await request
                .post('/4_0_0/Organization/733797173/$merge')
                .send(practiceOrganizationResource)
                .set(getHeaders())
                .expect(200);
            console.log('------- response practiceOrganizationResource ------------');
            console.log(JSON.stringify(resp.body, null, 2));
            console.log('------- end response  ------------');
            expect(resp.body['created']).toBe(true);
            resp = await request
                .post('/4_0_0/Organization/1234/$merge')
                .send(practiceOrganizationResource2)
                .set(getHeaders())
                .expect(200);
            console.log('------- response practiceOrganizationResource ------------');
            console.log(JSON.stringify(resp.body, null, 2));
            console.log('------- end response  ------------');
            expect(resp.body['created']).toBe(true);
            resp = await request
                .get(
                    '/4_0_0/Organization?type=http://terminology.hl7.org/CodeSystem/organization-type|prov'
                )
                .set(getHeaders())
                .expect(200);
            console.log('------- response Practitioner ------------');
            console.log(JSON.stringify(resp.body, null, 2));
            console.log('------- end response  ------------');
            // clear out the lastUpdated column since that changes
            let body = resp.body;
            expect(body.length).toBe(1);
            body.forEach((element) => {
                delete element['meta']['lastUpdated'];
            });
            let expected = expectedOrganizationResource;
            expected.forEach((element) => {
                if ('meta' in element) {
                    delete element['meta']['lastUpdated'];
                }
                element['meta']['versionId'] = '1';
                if ('$schema' in element) {
                    delete element['$schema'];
                }
            });
            expect(body).toStrictEqual(expected);
        });
    });
});
