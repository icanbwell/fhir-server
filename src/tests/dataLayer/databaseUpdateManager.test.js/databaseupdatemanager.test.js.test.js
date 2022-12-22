// test file
const person1Resource = require('./fixtures/Person/person1.json');
const person2Resource = require('./fixtures/Person/person2.json');

// expected
const expectedPersonResources = require('./fixtures/expected/expected_Person.json');

const {commonBeforeEach, commonAfterEach, createTestRequest, getTestContainer} = require('../../common');
const {describe, beforeEach, afterEach, test} = require('@jest/globals');
const Person = require('../../../fhir/classes/4_0_0/resources/person');

describe('Person Tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('Person databaseUpdateManager.test.js Tests', () => {
        test('databaseUpdateManager.test.js works', async () => {
            await createTestRequest();
            /**
             * @type {SimpleContainer}
             */
            const container = getTestContainer();

            /**
             * @type {DatabaseUpdateFactory}
             */
            const databaseUpdateFactory = container.databaseUpdateFactory;
            expect(databaseUpdateFactory).toBeDefined();

            /**
             * @type {DatabaseUpdateManager}
             */
            const databaseUpdateManager = databaseUpdateFactory.createDatabaseUpdateManager({
                resourceType: 'Person',
                base_version: '4_0_0'
            });

            await databaseUpdateManager.insertOneAsync({doc: new Person(person1Resource)});

            await databaseUpdateManager.replaceOneAsync({doc: new Person(person2Resource)});

            /**
             * @type {DatabaseQueryFactory}
             */
            const databaseQueryFactory = container.databaseQueryFactory;
            expect(databaseQueryFactory).toBeDefined();

            const databaseQueryManager = databaseQueryFactory.createQuery({
                resourceType: 'Person',
                base_version: '4_0_0'
            });
            /**
             * @type {Resource|null}
             */
            const resource = await databaseQueryManager.findOneAsync(
                {
                    query: {'id': '9b3326ba-2421-4b9a-9d57-1eba0481cbd4'}
                }
            );
            expect(resource.toJSON()).toStrictEqual(expectedPersonResources);
        });
    });
});
