// provider file
const practitionerResource = require('./fixtures/practitioner/practitioner.json');
const practitionerResource2 = require('./fixtures/practitioner/practitioner2.json');

// expected
const expectedPractitionerResource = require('./fixtures/expected/expected_practitioner.json');

const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    createTestRequest,
} = require('../../common');
const { describe, beforeEach, afterEach, expect, test } = require('@jest/globals');

describe('PractitionerSearchAllReturnTotalTests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('Practitioner Search All Return Total Tests', () => {
        test('search all return total works', async () => {
            const request = await createTestRequest();
            let resp = await request.get('/4_0_0/Practitioner').set(getHeaders()).expect(200);
            expect(resp.body.length).toBe(0);
            console.log('------- response 1 ------------');
            console.log(JSON.stringify(resp.body, null, 2));
            console.log('------- end response 1 ------------');

            resp = await request
                .post('/4_0_0/Practitioner/1679033641/$merge?validate=true')
                .send(practitionerResource)
                .set(getHeaders())
                .expect(200);
            console.log('------- response practitionerResource ------------');
            console.log(JSON.stringify(resp.body, null, 2));
            console.log('------- end response  ------------');
            expect(resp.body['created']).toBe(true);
            resp = await request
                .post('/4_0_0/Practitioner/0/$merge')
                .send(practitionerResource2)
                .set(getHeaders())
                .expect(200);
            console.log('------- response practitionerResource ------------');
            console.log(JSON.stringify(resp.body, null, 2));
            console.log('------- end response  ------------');
            expect(resp.body['created']).toBe(true);
            resp = await request.get('/4_0_0/Practitioner').set(getHeaders()).expect(200);
            console.log('------- response 3 ------------');
            console.log(JSON.stringify(resp.body, null, 2));
            console.log('------- end response 3 ------------');

            resp = await request
                .get('/4_0_0/Practitioner?_count=10&_bundle=1&_total=accurate')
                .set(getHeaders('user/*.* access/*.*'))
                .expect(200);
            console.log('------- response Practitioner sorted ------------');
            console.log(JSON.stringify(resp.body, null, 2));
            console.log('------- end response sort ------------');
            // clear out the lastUpdated column since that changes
            let body = resp.body;
            expect(body.entry.length).toBe(2);
            delete body.timestamp;
            body.entry.forEach((element) => {
                delete element['resource']['meta']['lastUpdated'];
            });
            let expected = expectedPractitionerResource;
            expected.entry.forEach((element) => {
                delete element['resource']['meta']['lastUpdated'];
                delete element['resource']['$schema'];
            });
            // expected[0]['meta'] = { 'versionId': '2' };
            expect(body).toStrictEqual(expected);

            resp = await request
                .get('/4_0_0/Practitioner?_count=10&id=0&_bundle=1&_total=accurate')
                .set(getHeaders('user/*.* access/*.*'))
                .expect(200);
            console.log('------- response Practitioner sorted ------------');
            console.log(JSON.stringify(resp.body, null, 2));
            console.log('------- end response sort ------------');
            // clear out the lastUpdated column since that changes
            body = resp.body;
            expect(body.entry.length).toBe(1);
            expect(body.total).toStrictEqual(1);
        });
    });
});
