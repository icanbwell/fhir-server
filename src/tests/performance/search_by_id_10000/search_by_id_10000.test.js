const supertest = require('supertest');
const deepcopy = require('deepcopy');
const {app} = require('../../../app');
// provider file
const practitionerResource = require('./fixtures/practitioner/practitioner.json');

const request = supertest(app);
const {commonBeforeEach, commonAfterEach, getHeaders, getHeadersNdJson} = require('../../common');

describe('PractitionerReturnIdTests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('Practitioner Search By 10,0000 Tests', () => {
        test('search by 10,000 id works', async () => {
            // first confirm there are no practitioners
            let resp = await request
                .get('/4_0_0/Practitioner')
                .set(getHeaders())
                .expect(200);
            expect(resp.body.length).toBe(0);
            console.log('------- response 1 ------------');
            console.log(JSON.stringify(resp.body, null, 2));
            console.log('------- end response 1 ------------');

            const initialId = practitionerResource.id;
            const bundle = {
                resourceType: 'Bundle',
                entry: []
            };
            const numberOfResources = 10000;
            for (let i = 0; i < numberOfResources; i++) {
                practitionerResource.id = initialId + '-' + i;
                bundle.entry.push({
                    resource: deepcopy(practitionerResource)
                });
            }

            // now add a record
            resp = await request
                .post('/4_0_0/Practitioner/0/$merge?validate=true')
                .send(bundle)
                .set(getHeaders())
                .expect(200);

            console.log('------- response 1 ------------');
            console.log(JSON.stringify(resp.body, null, 2));
            console.log('------- end response 1 ------------');
            expect(resp.body.length).toBe(numberOfResources);
            for (const result of resp.body) {
                expect(result.created).toStrictEqual(true);
            }

            // now check that we get the right record back
            resp = await request
                .get('/4_0_0/Practitioner/?_count=10')
                .set(getHeaders())
                .expect(200);
            console.log('------- response Practitioner sorted ------------');
            console.log(JSON.stringify(resp.body, null, 2));
            console.log('------- end response sort ------------');
            expect(resp.body.length).toBe(10);

            // now check that we get the right record back
            resp = await request
                .get('/4_0_0/Practitioner/?_streamResponse=1')
                .set(getHeadersNdJson())
                .expect(200);
            console.log('------- response Practitioner sorted ------------');
            console.log(JSON.stringify(resp.body, null, 2));
            console.log('------- end response sort ------------');
            const lines = resp.text.split('\n');
            expect(lines.length).toBe(numberOfResources + 1);
        }, 120 * 1000);
    });
});
