// test file
// const observation1Resource = require('./fixtures/Observation/observation1.json');

// expected
// const expectedObservationResources = require('./fixtures/expected/expected_observation.json');

const { commonBeforeEach, commonAfterEach, createTestRequest, getTestContainer } = require('../../common');
const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');
const { assertTypeEquals } = require('../../../../utils/assertType');
const { EnrichmentManager } = require('../../../../enrich/enrich');
const { R4ArgsParser } = require('../../../../operations/query/r4ArgsParser');
const { VERSIONS } = require('../../../../middleware/fhir/utils/constants');

describe('Observation Tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('Observation globalIdEnrichmentProvider Tests', () => {
        test('globalIdEnrichmentProvider works with id', async () => {

            const request = await createTestRequest();
            /**
             * @type {SimpleContainer}
             */
            const container = getTestContainer();

            /**
             * @type {EnrichmentManager}
             */
            const enrichmentManager = container.enrichmentManager;
            assertTypeEquals(enrichmentManager, EnrichmentManager);

            /**
             * @type  {R4ArgsParser}
             */
            const r4ArgsParser = container.r4ArgsParser;
            assertTypeEquals(r4ArgsParser, R4ArgsParser);

            const parsedArgs = r4ArgsParser.parseArgs({
                resourceType: 'Patient',
                args: {
                    base_version: VERSIONS['4_0_0']
                }
            });

            parsedArgs.headers = {
                prefer: 'global_id=true'
            };

            const resources = [
                {
                    resourceType: 'Patient',
                    id: '1',
                    _uuid: '57881c89-78ca-4c66-91f7-2b8a9f99406a'
                }
            ];

            const updatedResources = await enrichmentManager.enrichAsync({
                resources,
                parsedArgs
            });
            expect(updatedResources).toStrictEqual([
                {
                    _uuid: '57881c89-78ca-4c66-91f7-2b8a9f99406a',
                    id: '57881c89-78ca-4c66-91f7-2b8a9f99406a',
                    identifier: [
                        {
                            id: 'uuid',
                            system: 'https://www.icanbwell.com/uuid',
                            value: '57881c89-78ca-4c66-91f7-2b8a9f99406a'
                        }
                    ],
                    resourceType: 'Patient'
                }
            ]);
        });
    });
});
