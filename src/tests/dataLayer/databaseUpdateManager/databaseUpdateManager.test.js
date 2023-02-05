// test file
const person1Resource = require('./fixtures/Person/person1.json');
const person2Resource = require('./fixtures/Person/person2.json');
const person3Resource = require('./fixtures/Person/person3.json');

// expected
const expectedPersonResources = require('./fixtures/expected/expected_Person.json');
const expectedPersonBeforeUpdateResources = require('./fixtures/expected/expected_Person_before_update.json');
const expectedPerson3Resources = require('./fixtures/expected/expected_Person3.json');

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
        test('databaseUpdateManager works with normal replace', async () => {
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
            const resourceBeforeReplace = await databaseQueryManager.findOneAsync(
                {
                    query: {'id': '9b3326ba-2421-4b9a-9d57-1eba0481cbd4'}
                }
            );
            resourceBeforeReplace.meta.lastUpdated = null;
            expect(resourceBeforeReplace.toJSON()).toStrictEqual(expectedPersonBeforeUpdateResources);

            // Now replace it
            await databaseUpdateManager.replaceOneAsync({doc: new Person(person2Resource)});

            /**
             * @type {Resource|null}
             */
            const resource = await databaseQueryManager.findOneAsync(
                {
                    query: {'id': '9b3326ba-2421-4b9a-9d57-1eba0481cbd4'}
                }
            );
            resource.meta.lastUpdated = null;
            expect(resource.toJSON()).toStrictEqual(expectedPersonResources);
        });
        test('databaseUpdateManager works with same replace twice', async () => {
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
            resource.meta.lastUpdated = null;
            expect(resource.toJSON()).toStrictEqual(expectedPersonResources);
        });
        test('databaseUpdateManager works with different replace twice', async () => {
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

            await databaseUpdateManager.replaceOneAsync({doc: new Person(person3Resource)});

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
            resource.meta.lastUpdated = null;
            expect(resource.toJSON()).toStrictEqual(expectedPerson3Resources);
        });
        test('databaseUpdateManager works with different replace twice and one existing replace', async () => {
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

            await databaseUpdateManager.replaceOneAsync({doc: new Person(person3Resource)});

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
            resource.meta.lastUpdated = null;
            expect(resource.toJSON()).toStrictEqual(expectedPerson3Resources);
        });
    });
});
