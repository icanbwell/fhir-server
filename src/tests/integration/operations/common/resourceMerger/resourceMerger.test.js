const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');
const { commonBeforeEach, commonAfterEach, getTestRequestInfo } = require('../../../common');

const { TestMongoDatabaseManager } = require('../../../testMongoDatabaseManager');
const { ConfigManager } = require('../../../../../utils/configManager');
const { PreSaveManager } = require('../../../../../preSaveHandlers/preSave');

const person1Resource = require('./fixtures/Person/person1.json');
const personMergeResource = require('./fixtures/Person/person2.json');
// const expectedPersonResource = require('./fixtures/expected/expected_person.json');

const { ResourceMerger } = require('../../../../../operations/common/resourceMerger');
const deepcopy = require('deepcopy');
const deepmerge = require('deepmerge');
const { mergeObject } = require('../../../../../utils/mergeHelper');
const { UuidColumnHandler } = require('../../../../../preSaveHandlers/handlers/uuidColumnHandler');
const { PatientFilterManager } = require('../../../../../fhir/patientFilterManager');

describe('ResourceMerger Tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('ResourceMerger Tests', () => {
        const base_version = '4_0_0';
        test('ResourceMerger returns null with identical resources', async () => {
            const configManager = new ConfigManager();
            /**
             * @type {MongoDatabaseManager}
             */
            const mongoDatabaseManager = new TestMongoDatabaseManager({ configManager });
            await mongoDatabaseManager.dropDatabasesAsync();
            const resourceMerger = new ResourceMerger({
                preSaveManager: new PreSaveManager({
                    preSaveHandlers: [
                        new UuidColumnHandler({
                            configManager
                        })
                    ]
                }),
                patientFilterManager: new PatientFilterManager()
            });
            const currentResource = deepcopy(person1Resource);
            const resourceToMerge = deepcopy(personMergeResource);

            // first try merge of the raw json
            let mergedObject = deepmerge(person1Resource, personMergeResource);
            expect(mergedObject.gender).toStrictEqual('male');

            // then try merge of the resources
            mergedObject = deepmerge(currentResource, resourceToMerge);
            expect(mergedObject.gender).toStrictEqual('male');

            // now try merge with our options
            mergedObject = mergeObject(currentResource, resourceToMerge);
            expect(mergedObject.gender).toStrictEqual('male');

            const requestInfo = getTestRequestInfo({ requestId: '1234' });

            /**
             * @type {{updatedResource: (Resource|null)}}
             */
            const result = await resourceMerger.fastMergeResourceAsync({
                base_version,
                requestInfo,
                currentResource,
                resourceToMerge
            });
            expect(result.updatedResource).toStrictEqual(null);
        });
    });
});
