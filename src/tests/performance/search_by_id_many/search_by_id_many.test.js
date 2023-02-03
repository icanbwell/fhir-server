const deepcopy = require('deepcopy');
// provider file
const practitionerResource = require('./fixtures/practitioner/practitioner.json');

const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    getHeadersNdJson,
    createTestRequest,
} = require('../../common');
const {describe, beforeEach, afterEach, expect, test} = require('@jest/globals');
const env = require('var');
const {logInfo} = require('../../../operations/common/logging');
let oldEnvLogLevel;

describe('PractitionerReturnIdTests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
        oldEnvLogLevel = env.LOGLEVEL;
        env.LOGLEVEL = 'INFO'; // turn off detailed trace since that is slow
    });

    afterEach(async () => {
        await commonAfterEach();
        env.LOGLEVEL = oldEnvLogLevel;
    });

    describe('Practitioner Search By 10,0000 Tests', () => {
        test(
            'search by 2,000 id works',
            async () => {
                const request = await createTestRequest();
                // first confirm there are no practitioners
                let resp = await request.get('/4_0_0/Practitioner').set(getHeaders()).expect(200);
                expect(resp.body.length).toBe(0);
                logInfo('------- response 1 ------------');
                logInfo('', {'resp': resp.body});
                logInfo('------- end response 1 ------------');

                const initialId = practitionerResource.id;
                const bundle = {
                    resourceType: 'Bundle',
                    entry: [],
                };
                const numberOfResources = 2000;
                for (let i = 0; i < numberOfResources; i++) {
                    practitionerResource.id = initialId + '-' + i;
                    bundle.entry.push({
                        resource: deepcopy(practitionerResource),
                    });
                }

                // now add a record
                resp = await request
                    .post('/4_0_0/Practitioner/0/$merge?validate=true')
                    .send(bundle)
                    .set(getHeaders());

                logInfo('------- response 1 ------------');
                logInfo('', {'resp': resp.body});
                logInfo('------- end response 1 ------------');
                expect(resp.body.length).toBe(numberOfResources);
                for (const result of resp.body) {
                    expect(result.created).toStrictEqual(true);
                }

                // now check that we get the right record back
                resp = await request
                    .get('/4_0_0/Practitioner/?_count=10')
                    .set(getHeaders())
                    .expect(200);
                logInfo('------- response Practitioner sorted ------------');
                logInfo('', {'resp': resp.body});
                logInfo('------- end response sort ------------');
                expect(resp.body.length).toBe(10);

                // now check that we get the right record back
                resp = await request
                    .get(`/4_0_0/Practitioner/?_streamResponse=1&_count=${numberOfResources}`)
                    .set(getHeadersNdJson())
                    .expect(200);
                logInfo('------- response Practitioner sorted ------------');
                logInfo('', {'resp': resp.body});
                logInfo('------- end response sort ------------');
                const lines = resp.text.split('\n');
                expect(lines.length).toBe(numberOfResources + 1);
            },
            240 * 1000
        );
    });
});
