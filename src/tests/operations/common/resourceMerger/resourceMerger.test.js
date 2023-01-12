const {describe, beforeEach, afterEach, test} = require('@jest/globals');
const {commonBeforeEach, commonAfterEach} = require('../../../common');

const {TestMongoDatabaseManager} = require('../../../testMongoDatabaseManager');
const {PreSaveManager} = require('../../../../preSaveHandlers/preSave');

const person1Resource = require('./fixtures/Person/person1.json');
const personMergeResource = require('./fixtures/Person/person2.json');
const expectedPersonResource = require('./fixtures/expected/expected_person.json');


const {ResourceMerger} = require('../../../../operations/common/resourceMerger');
const Person = require('../../../../fhir/classes/4_0_0/resources/person');

describe('ResourceMerger Tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('ResourceMerger Tests', () => {
        test('ResourceMerger works', async () => {
            /**
             * @type {MongoDatabaseManager}
             */
            const mongoDatabaseManager = new TestMongoDatabaseManager();
            await mongoDatabaseManager.dropDatabasesAsync();
            const resourceMerger = new ResourceMerger({
                preSaveManager: new PreSaveManager({preSaveHandlers: []})
            });
            /**
             * @type {{updatedResource: (Resource|null), patches: (MergePatchEntry[]|null)}}
             */
            const result = await resourceMerger.mergeResourceAsync(
                {
                    currentResource: new Person(person1Resource),
                    resourceToMerge: new Person(personMergeResource),
                }
            );
            expect(result.updatedResource).toStrictEqual(expectedPersonResource);
        });
    });
});
