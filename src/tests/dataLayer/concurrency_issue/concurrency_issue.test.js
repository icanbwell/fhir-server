// test file
const codesystem1Resource = require('./fixtures/CodeSystem/codesystem.json');

// expected
const expectedCodeSystemResources = require('./fixtures/expected/expected_codesystem.json');
const expectedCodeSystemHistoryResources = require('./fixtures/expected/expected_codesystem_history.json');
const expectedCodeSystemsFromDatabase = require('./fixtures/expected/expected_codesystem_from_database.json');

const {commonBeforeEach, commonAfterEach, getHeaders, createTestRequest, getTestContainer} = require('../../common');
const {describe, beforeEach, afterEach, test} = require('@jest/globals');
const CodeSystem = require('../../../fhir/classes/4_0_0/resources/codeSystem');
const moment = require('moment-timezone');
const Meta = require('../../../fhir/classes/4_0_0/complex_types/meta');
const Coding = require('../../../fhir/classes/4_0_0/complex_types/coding');
const deepcopy = require('deepcopy');

describe('CodeSystem Tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('CodeSystem concurrency_issue Tests', () => {
        test('concurrency_issue works', async () => {
            console.log('start test: concurrency_issue works');
            const request = await createTestRequest();
            // ARRANGE
            /**
             * @type {SimpleContainer}
             */
            const container = getTestContainer();
            expect(container).toBeDefined();
            /**
             * @type {MongoCollectionManager}
             */
            const mongoCollectionManager = container.mongoCollectionManager;
            expect(mongoCollectionManager).toBeDefined();
            /**
             * @type {MongoDatabaseManager}
             */
            const mongoDatabaseManager = container.mongoDatabaseManager;
            /**
             * mongo auditEventDb connection
             * @type {import('mongodb').Db}
             */
            const fhirDb = await mongoDatabaseManager.getClientDbAsync();
            const collectionName = 'CodeSystem_4_0_0';
            await mongoCollectionManager.clearCollectionAsync({
                db: fhirDb,
                collectionName
            });
            expect(await fhirDb.collection(collectionName).countDocuments()).toStrictEqual(0);

            // Currently we don't handle concurrent inserts of same resource so create
            // a simple one first
            const simpleCodeSystem = new CodeSystem({
                'id': 'medline-loinc-labs',
                'meta': new Meta({
                    'source': 'https://connect.medlineplus.gov/service',
                    'security': [
                        new Coding({
                            'system': 'https://www.icanbwell.com/owner',
                            'code': 'medlineplus'
                        }),
                        new Coding({
                            'system': 'https://www.icanbwell.com/access',
                            'code': 'medlineplus'
                        }),
                        new Coding({
                            'system': 'https://www.icanbwell.com/vendor',
                            'code': 'medlineplus'
                        })
                    ]
                }),
                'status': 'active',
                'content': 'fragment',
            });
            let resp = await request
                .post('/4_0_0/CodeSystem/1/$merge?validate=true')
                .send(simpleCodeSystem)
                .set(getHeaders());

            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({'created': true});
            // add the resources to FHIR server
            let [response1, response2] = await Promise.all(
                [
                    request
                        .post('/4_0_0/CodeSystem/1/$merge?validate=true')
                        .send(codesystem1Resource)
                        .set(getHeaders()),
                    request
                        .post('/4_0_0/CodeSystem/1/$merge?validate=true')
                        .send(codesystem1Resource)
                        .set(getHeaders())
                ]
            );
            // noinspection JSUnresolvedFunction
            expect(response1).toHaveMergeResponse({'id': 'medline-loinc-labs'});
            // noinspection JSUnresolvedFunction
            expect(response2).toHaveMergeResponse({'id': 'medline-loinc-labs'});

            const codeSystemsInDatabase = await fhirDb.collection(collectionName).find({}).toArray();
            expect(codeSystemsInDatabase).toBeArrayOfSize(1);
            expect(codeSystemsInDatabase[0].concept).toBeArrayOfSize(29);

            // return;

            expect(response1._body['0'].created === false || response2._body['0'].created === false).toBeTrue();
            expect(response1._body['0'].updated === false || response2._body['0'].updated === false).toBeTrue();
            expect(response1._body['0'].updated === true || response2._body['0'].updated === true).toBeTrue();

            // ACT & ASSERT
            // ACT & ASSERT
            // search by token system and code and make sure we get the right CodeSystem back
            resp = await request
                .get('/4_0_0/CodeSystem/?_bundle=1&id=medline-loinc-labs')
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedCodeSystemResources);

            // get history
            resp = await request
                .get('/4_0_0/CodeSystem/medline-loinc-labs/_history?_bundle=1')
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedCodeSystemHistoryResources);
            console.log('finish test: concurrency_issue works');
        });
        test('concurrency_issue works with databaseUpdateManager', async () => {
            console.log('start test: concurrency_issue works with databaseUpdateManager');
            await createTestRequest();
            /**
             * @type {SimpleContainer}
             */
            const container = getTestContainer();
            expect(container).toBeDefined();
            /**
             * @type {MongoCollectionManager}
             */
            const mongoCollectionManager = container.mongoCollectionManager;
            expect(mongoCollectionManager).toBeDefined();
            /**
             * @type {MongoDatabaseManager}
             */
            const mongoDatabaseManager = container.mongoDatabaseManager;
            /**
             * mongo auditEventDb connection
             * @type {import('mongodb').Db}
             */
            const fhirDb = await mongoDatabaseManager.getClientDbAsync();
            const collectionName = 'CodeSystem_4_0_0';
            await mongoCollectionManager.clearCollectionAsync({
                db: fhirDb,
                collectionName
            });

            /**
             * @type {DatabaseUpdateFactory}
             */
            const databaseUpdateFactory = container.databaseUpdateFactory;
            expect(databaseUpdateFactory).toBeDefined();

            /**
             * @type {DatabaseUpdateManager}
             */
            const databaseUpdateManager = databaseUpdateFactory.createDatabaseUpdateManager({
                resourceType: 'CodeSystem',
                base_version: '4_0_0'
            });

            const countOfUpdates = codesystem1Resource.length;

            let i = 0;
            for (const codeSystem of codesystem1Resource) {
                // eslint-disable-next-line no-unused-vars
                i += 1;
                await databaseUpdateManager.replaceOneAsync({doc: new CodeSystem(codeSystem)});
            }

            /**
             * @type {DatabaseQueryFactory}
             */
            const databaseQueryFactory = container.databaseQueryFactory;
            expect(databaseQueryFactory).toBeDefined();

            const databaseQueryManager = databaseQueryFactory.createQuery({
                resourceType: 'CodeSystem',
                base_version: '4_0_0'
            });
            /**
             * @type {Resource|null}
             */
            const resource = await databaseQueryManager.findOneAsync(
                {
                    query: {'id': 'medline-loinc-labs'}
                }
            );
            resource.meta.lastUpdated = null;
            const expectedCodeSystemsFromDatabaseCopy = deepcopy(expectedCodeSystemsFromDatabase);
            expectedCodeSystemsFromDatabaseCopy.meta.versionId = '29'; // in case of databaseUpdateManager we expect the versionId to increment
            expect(resource.toJSON()).toStrictEqual(expectedCodeSystemsFromDatabaseCopy);

            expect(resource.toJSON().meta.versionId).toStrictEqual(`${countOfUpdates}`);
            console.log('finish test: concurrency_issue works with databaseUpdateManager');
        });
        test('concurrency_issue works with databaseBulkInserter', async () => {
            console.log('start test: concurrency_issue works with databaseBulkInserter');
            await createTestRequest();
            /**
             * @type {SimpleContainer}
             */
            const container = getTestContainer();
            expect(container).toBeDefined();
            /**
             * @type {MongoCollectionManager}
             */
            const mongoCollectionManager = container.mongoCollectionManager;
            expect(mongoCollectionManager).toBeDefined();
            /**
             * @type {MongoDatabaseManager}
             */
            const mongoDatabaseManager = container.mongoDatabaseManager;
            /**
             * mongo connection
             * @type {import('mongodb').Db}
             */
            const fhirDb = await mongoDatabaseManager.getClientDbAsync();
            const collectionName = 'CodeSystem_4_0_0';
            await mongoCollectionManager.clearCollectionAsync({
                db: fhirDb,
                collectionName
            });
            expect(await fhirDb.collection(collectionName).countDocuments()).toStrictEqual(0);

            /**
             * @type {DatabaseBulkInserter}
             */
            const databaseBulkInserter = container.databaseBulkInserter;
            expect(databaseBulkInserter).toBeDefined();

            const countOfUpdates = codesystem1Resource.length;

            const requestId = '1234';

            const firstCodeSystem = codesystem1Resource.splice(0, 1)[0];
            await databaseBulkInserter.insertOneAsync({
                requestId,
                resourceType: 'CodeSystem',
                doc: new CodeSystem(firstCodeSystem)
            });

            let i = 0;
            for (const codeSystem of codesystem1Resource) {
                // eslint-disable-next-line no-unused-vars
                i += 1;
                await databaseBulkInserter.mergeOneAsync(
                    {
                        requestId,
                        resourceType: 'CodeSystem',
                        id: 'medline-loinc-labs',
                        previousVersionId: '1',
                        doc: new CodeSystem(codeSystem),
                        upsert: false,
                        patches: null
                    }
                );
            }

            /**
             * @type {string}
             */
            const currentDate = moment.utc().format('YYYY-MM-DD');
            await databaseBulkInserter.executeAsync({
                requestId,
                currentDate,
                base_version: '4_0_0',
                method: 'POST'
            });

            /**
             * @type {PostRequestProcessor}
             */
            const postRequestProcessor = container.postRequestProcessor;
            await postRequestProcessor.executeAsync({requestId});
            await postRequestProcessor.waitTillDoneAsync({requestId});

            /**
             * @type {DatabaseQueryFactory}
             */
            const databaseQueryFactory = container.databaseQueryFactory;
            expect(databaseQueryFactory).toBeDefined();

            const databaseQueryManager = databaseQueryFactory.createQuery({
                resourceType: 'CodeSystem',
                base_version: '4_0_0'
            });
            /**
             * @type {Resource|null}
             */
            const resource = await databaseQueryManager.findOneAsync(
                {
                    query: {'id': 'medline-loinc-labs'}
                }
            );
            resource.meta.lastUpdated = null;
            expect(resource.toJSON().meta.versionId).toStrictEqual('1');
            expect(resource.toJSON().concept.length).toStrictEqual(countOfUpdates);

            const expectedCodeSystemsFromDatabaseCopy = deepcopy(expectedCodeSystemsFromDatabase);
            expectedCodeSystemsFromDatabaseCopy.meta.versionId = '1';

            expect(resource.toJSON()).toStrictEqual(expectedCodeSystemsFromDatabaseCopy);
            console.log('finish test: concurrency_issue works with databaseBulkInserter');
        });
        test('concurrency_issue works with databaseBulkInserter with insert in the middle', async () => {
            console.log('start test: concurrency_issue works with databaseBulkInserter with insert in the middle');
            await createTestRequest();
            /**
             * @type {SimpleContainer}
             */
            const container = getTestContainer();
            expect(container).toBeDefined();
            /**
             * @type {MongoCollectionManager}
             */
            const mongoCollectionManager = container.mongoCollectionManager;
            expect(mongoCollectionManager).toBeDefined();
            /**
             * @type {MongoDatabaseManager}
             */
            const mongoDatabaseManager = container.mongoDatabaseManager;
            /**
             * mongo connection
             * @type {import('mongodb').Db}
             */
            const fhirDb = await mongoDatabaseManager.getClientDbAsync();
            const collectionName = 'CodeSystem_4_0_0';
            await mongoCollectionManager.clearCollectionAsync({
                db: fhirDb,
                collectionName
            });
            const codeSystemCollection = fhirDb.collection(collectionName);
            expect(await codeSystemCollection.countDocuments()).toStrictEqual(0);

            /**
             * @type {DatabaseBulkInserter}
             */
            const databaseBulkInserter = container.databaseBulkInserter;
            expect(databaseBulkInserter).toBeDefined();

            const countOfUpdates = codesystem1Resource.length;

            const requestId = '1234';

            const firstCodeSystem = codesystem1Resource.splice(0, 1)[0];
            await databaseBulkInserter.insertOneAsync({
                requestId,
                resourceType: 'CodeSystem',
                doc: new CodeSystem(firstCodeSystem)
            });

            let i = 0;
            for (const codeSystem of codesystem1Resource) {
                // eslint-disable-next-line no-unused-vars
                i += 1;
                if (i === 10) {
                    const doc = new CodeSystem(firstCodeSystem);
                    doc.meta.versionId = '2';
                    await codeSystemCollection.insertOne(doc.toJSONInternal());
                }
                await databaseBulkInserter.mergeOneAsync(
                    {
                        requestId,
                        resourceType: 'CodeSystem',
                        id: 'medline-loinc-labs',
                        previousVersionId: '1',
                        doc: new CodeSystem(codeSystem),
                        upsert: false,
                        patches: null
                    }
                );
            }

            /**
             * @type {string}
             */
            const currentDate = moment.utc().format('YYYY-MM-DD');
            await databaseBulkInserter.executeAsync({
                requestId,
                currentDate,
                base_version: '4_0_0',
                method: 'POST'
            });

            /**
             * @type {PostRequestProcessor}
             */
            const postRequestProcessor = container.postRequestProcessor;
            await postRequestProcessor.executeAsync({requestId});
            await postRequestProcessor.waitTillDoneAsync({requestId});

            /**
             * @type {DatabaseQueryFactory}
             */
            const databaseQueryFactory = container.databaseQueryFactory;
            expect(databaseQueryFactory).toBeDefined();

            const databaseQueryManager = databaseQueryFactory.createQuery({
                resourceType: 'CodeSystem',
                base_version: '4_0_0'
            });
            /**
             * @type {Resource|null}
             */
            const resource = await databaseQueryManager.findOneAsync(
                {
                    query: {'id': 'medline-loinc-labs'}
                }
            );
            resource.meta.lastUpdated = null;
            expect(resource.toJSON().meta.versionId).toStrictEqual('3');
            expect(resource.toJSON().concept.length).toStrictEqual(countOfUpdates);

            const expectedCodeSystemsFromDatabaseCopy = deepcopy(expectedCodeSystemsFromDatabase);

            expectedCodeSystemsFromDatabaseCopy.meta.versionId = '3';

            expect(resource.toJSON()).toStrictEqual(expectedCodeSystemsFromDatabaseCopy);
            console.log('finish test: concurrency_issue works with databaseBulkInserter with update in the middle');
        });
    });
});
