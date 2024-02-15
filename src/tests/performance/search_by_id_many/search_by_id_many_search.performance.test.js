// provider file
const practitionerResource = require('./fixtures/practitioner/practitioner.json');

const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    getHeadersNdJson,
    createTestRequest, getTestContainer
} = require('../../common');
const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');
const env = require('var');
const { ConfigManager } = require('../../../utils/configManager');
const { ResponseChunkParser } = require('../responseChunkParser');
const { assertTypeEquals } = require('../../../utils/assertType');
const { PreSaveManager } = require('../../../preSaveHandlers/preSave');
const Practitioner = require('../../../fhir/classes/4_0_0/resources/practitioner');
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
        return 100;
    }

    get logStreamSteps () {
        return false;
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

    describe('Practitioner Search By 10,0000 Tests', () => {
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
                const numberOfResources = 20000;
                for (let i = 0; i < numberOfResources; i++) {
                    const newId = initialId + '-' + i;
                    practitionerResource.id = newId;
                    bundle.entry.push({
                        resource: Object.assign({}, practitionerResource, { id: newId })
                    });
                }
                /**
                 * @type {SimpleContainer}
                 */
                const container = getTestContainer();

                /**
                 * @type {PreSaveManager}
                 */
                const preSaveManager = container.preSaveManager;
                assertTypeEquals(preSaveManager, PreSaveManager);

                for (const entry of bundle.entry) {
                    entry.resource = await preSaveManager.preSaveAsync(new Practitioner(entry.resource));
                }

                console.log(`Saving ${numberOfResources} resources...`);
                /**
                 * @type {MongoDatabaseManager}
                 */
                const mongoDatabaseManager = container.mongoDatabaseManager;
                const db = await mongoDatabaseManager.getClientDbAsync();
                const resourceType = 'Practitioner';
                const base_version = '4_0_0';
                /**
                 * @type {import('mongodb').Collection<import('mongodb').Document>}
                 */
                const collection = db.collection(`${resourceType}_${base_version}`);

                await collection.insertMany(bundle.entry.map(e => e.resource.toJSONInternal()));

                console.log(`Finished saving ${numberOfResources} resources.`);

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
