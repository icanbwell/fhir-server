const practitionerBundleResource = require('./fixtures/providers/practitioner_bundle.json');
const expectedPractitionerBundleResource = require('./fixtures/providers/expected_practitioner_bundle.json');

const {commonBeforeEach, commonAfterEach, getHeaders, createTestRequest} = require('../../common');
const {describe, beforeEach, afterEach, expect} = require('@jest/globals');

describe('Practitioner Merge Resource List Tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('Practitioner Merge Resource List', () => {
        test('Multiple calls to Practitioner merge resource list properly', async () => {
            const request = await createTestRequest();
            let resp = await request
                .get('/4_0_0/Practitioner')
                .set(getHeaders());

            expect(resp.body.length).toBe(0);
            console.log('------- response 1 ------------');
            console.log(JSON.stringify(resp.body, null, 2));
            console.log('------- end response 1 ------------');

            resp = await request
                .post('/4_0_0/Practitioner/4657/$merge')
                .send(practitionerBundleResource)
                .set(getHeaders());
            console.log('------- response 2 ------------');
            console.log(JSON.stringify(resp.body, null, 2));
            console.log('------- end response 2  ------------');
            resp = await request
                .get('/4_0_0/Practitioner')
                .set(getHeaders());

            // clear out the lastUpdated column since that changes
            let body = resp.body;
            console.log('------- response 5 ------------');
            console.log(JSON.stringify(resp.body, null, 2));
            console.log('------- end response 5  ------------');
            expect(body.length).toBe(2);
            body.forEach(element => {
                delete element['meta']['lastUpdated'];
            });
            let expected = expectedPractitionerBundleResource;
            expected.forEach(element => {
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
