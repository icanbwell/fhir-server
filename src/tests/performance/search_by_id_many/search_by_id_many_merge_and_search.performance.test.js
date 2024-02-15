const deepcopy = require('deepcopy');
// provider file
const practitionerResource = require('./fixtures/practitioner/practitioner.json');

const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    getHeadersNdJson,
    createTestRequest
} = require('../../common');
const {describe, beforeEach, afterEach, test, expect} = require('@jest/globals');
const env = require('var');
const {ConfigManager} = require('../../../utils/configManager');
const {ResponseChunkParser} = require('../responseChunkParser');
let oldEnvLogLevel;

class MockConfigManagerStreaming extends ConfigManager {
    get defaultSortId () {
        return '_uuid';
    }

    get streamResponse () {
        return true;
    }

    get enableReturnBundle () {
        return true;
    }

    get streamingHighWaterMark () {
        return 1;
    }

    get logStreamSteps () {
        return true;
    }

    get enableTwoStepOptimization () {
        return false;
    }
}

describe('seach by id many performance', () => {
    beforeEach(async () => {
        await commonBeforeEach();
        oldEnvLogLevel = env.LOGLEVEL;
        env.LOGLEVEL = 'INFO'; // turn off detailed trace since that is slow
    });

    afterEach(async () => {
        await commonAfterEach();
        env.LOGLEVEL = oldEnvLogLevel;
    });

    describe('Practitioner Merge & Search By 10,0000 Tests', () => {
        // noinspection FunctionWithMultipleLoopsJS
        test(
            'search by 2,000 id works',
            async () => {
                const request = await createTestRequest((c) => {
                    c.register('configManager', () => new MockConfigManagerStreaming());
                    return c;
                });
                // first confirm there are no practitioners
                let resp = await request.get('/4_0_0/Practitioner').set(getHeaders());
                // noinspection JSUnresolvedReference
                expect(resp).toHaveResourceCount(0);

                const initialId = practitionerResource.id;
                const bundle = {
                    resourceType: 'Bundle',
                    entry: []
                };
                const numberOfResources = 2000;
                for (let i = 0; i < numberOfResources; i++) {
                    practitionerResource.id = initialId + '-' + i;
                    bundle.entry.push({
                        resource: deepcopy(practitionerResource)
                    });
                }

                console.log(`Sending ${numberOfResources} resources...`);
                // now add a record
                resp = await request
                    .post('/4_0_0/Practitioner/0/$merge?validate=true')
                    .send(bundle)
                    .set(getHeaders());

                // noinspection JSUnresolvedReference
                expect(resp).toHaveResourceCount(numberOfResources);
                for (const result of resp.body) {
                    expect(result.created).toStrictEqual(true);
                }

                console.log(`Finished sending ${numberOfResources} resources.`);

                // now check that we get the right record back
                resp = await request
                    .get('/4_0_0/Practitioner/?_count=10')
                    .set(getHeaders())
                    .on('response', (res) => {
                        // Handle response headers
                        console.log('Response headers:', res.headers);
                    })
                    .on('error', (res) => {
                        console.log('Response error:', res);
                    })
                    .parse(new ResponseChunkParser().getFhirBundleParser());
                // noinspection JSUnresolvedReference
                expect(resp).toHaveResourceCount(10);

                // now check that we get the right record back
                resp = await request
                    .get(`/4_0_0/Practitioner/?_streamResponse=1&_count=${numberOfResources}`)
                    .set(getHeadersNdJson())
                    .on('response', (res) => {
                        // Handle response headers
                        console.log('Response headers:', res.headers);
                    })
                    .on('error', (res) => {
                        console.log('Response error:', res);
                    })
                    .parse(new ResponseChunkParser().getTextParser())
                    .expect(200);

                const lines = resp.text.split('\n');
                expect(lines.length).toBe(numberOfResources + 1);
            },
            240 * 1000
        );
    });
});
