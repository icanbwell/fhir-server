// test file
const codesystem1Resource = require('./fixtures/CodeSystem/codesystem.json');

// expected
const expectedCodeSystemResources = require('./fixtures/expected/expected_codesystem.json');
const expectedCodeSystemHistoryResources = require('./fixtures/expected/expected_codesystem_history.json');
const expectedCodeSystemsFromDatabase = require('./fixtures/expected/expected_codesystem_from_database.json');

const { commonBeforeEach, commonAfterEach, getHeaders, createTestRequest, getTestContainer, getTestRequestInfo } = require('../../common');
const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');
const deepcopy = require('deepcopy');
const { FhirResourceWriteSerializer } = require('../../../../fhir/fhirResourceWriteSerializer');
const { FhirResourceSerializer } = require('../../../../fhir/fhirResourceSerializer');
const { logInfo } = require('../../../../operations/common/logging');

const identityExtensionUrls = [
    'https://www.icanbwell.com/sourceId',
    'https://www.icanbwell.com/uuid',
    'https://www.icanbwell.com/sourceAssigningAuthority'
];

const withoutIdentityExtensions = (value) => {
    if (Array.isArray(value)) {
        return value.map(withoutIdentityExtensions);
    }
    if (value === null || typeof value !== 'object' || value instanceof Date) {
        return value;
    }
    return Object.fromEntries(
        Object.entries(value)
            .map(([key, child]) => [
                key,
                key === 'extension' && Array.isArray(child)
                    ? child.filter((e) => !identityExtensionUrls.includes(e.url))
                    : child
            ])
            .filter(([key, child]) => !(key === 'extension' && child.length === 0))
            .map(([key, child]) => [key, withoutIdentityExtensions(child)])
    );
};

const toWriteDoc = (resource) => FhirResourceWriteSerializer.serialize({ obj: deepcopy(resource) });

const readCodeSystemJsonAsync = async (databaseQueryManager) => {
    const doc = await databaseQueryManager.fastFindOneAsync({ query: { id: 'medline-loinc-labs' } });
    doc.meta.lastUpdated = null;
    return withoutIdentityExtensions(FhirResourceSerializer.serialize(doc));
};

describe('CodeSystem Tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('CodeSystem concurrency_issue Tests', () => {
        const base_version = '4_0_0';
        test('concurrency_issue works', async () => {
            logInfo('start test: concurrency_issue works', {});
            const request = await createTestRequest();
            // ARRANGE
            /**
             * @type {SimpleContainer}
             */
            const container = getTestContainer();
            expect(container).toBeDefined();
            /**
             * @type {import('../../../utils/postRequestProcessor').PostRequestProcessor}
             */
            const postRequestProcessor = container.postRequestProcessor;
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
            await fhirDb.collection(collectionName).deleteMany({});
            expect(await fhirDb.collection(collectionName).countDocuments()).toStrictEqual(0);

            // Currently we don't handle concurrent inserts of same resource so create
            // a simple one first
            const simpleCodeSystem = {
                resourceType: 'CodeSystem',
                id: 'medline-loinc-labs',
                meta: {
                    source: 'https://connect.medlineplus.gov/service',
                    security: [
                        {
                            system: 'https://www.icanbwell.com/owner',
                            code: 'medlineplus'
                        },
                        {
                            system: 'https://www.icanbwell.com/access',
                            code: 'medlineplus'
                        },
                        {
                            system: 'https://www.icanbwell.com/vendor',
                            code: 'medlineplus'
                        }
                    ]
                },
                status: 'active',
                content: 'fragment'
            };
            let resp = await request
                .post('/4_0_0/CodeSystem/1/$merge?validate=true')
                .send(simpleCodeSystem)
                .set(getHeaders());

            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });

            await postRequestProcessor.waitTillDoneAsync({ requestId: '1234' });

            // add the resources to FHIR server
            const [response1, response2] = await Promise.all(
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
            expect(response1).toHaveMergeResponse({ id: 'medline-loinc-labs' });
            // noinspection JSUnresolvedFunction
            expect(response2).toHaveMergeResponse({ id: 'medline-loinc-labs' });

            await postRequestProcessor.waitTillDoneAsync({ requestId: '1234' });

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

            expect(resp).toHaveResponse(expectedCodeSystemHistoryResources);
            logInfo('finish test: concurrency_issue works', {});
        });
        test('concurrency_issue works with databaseUpdateManager', async () => {
            logInfo('start test: concurrency_issue works with databaseUpdateManager', {});
            await createTestRequest();
            /**
             * @type {SimpleContainer}
             */
            const container = getTestContainer();
            expect(container).toBeDefined();
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
            await fhirDb.collection(collectionName).deleteMany({});

            /**
             * @type {DatabaseUpdateFactory}
             */
            const databaseUpdateFactory = container.databaseUpdateFactory;
            expect(databaseUpdateFactory).toBeDefined();

            /**
             * @type {FastDatabaseUpdateManager}
             */
            const databaseUpdateManager = databaseUpdateFactory.createFastDatabaseUpdateManager({
                resourceType: 'CodeSystem',
                base_version: '4_0_0'
            });

            const countOfUpdates = codesystem1Resource.length;

            const requestId = '1234';
            const requestInfo = getTestRequestInfo({ requestId });
            let i = 0;
            for (const codeSystem of codesystem1Resource) {

                i += 1;
                await databaseUpdateManager.replaceOneAsync({
                    base_version,
                    requestInfo,
                    doc: toWriteDoc(codeSystem)
                });
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
            const resource = await readCodeSystemJsonAsync(databaseQueryManager);
            const expectedCodeSystemsFromDatabaseCopy = deepcopy(expectedCodeSystemsFromDatabase);
            expectedCodeSystemsFromDatabaseCopy.meta.versionId = '29'; // in case of databaseUpdateManager we expect the versionId to increment
            expect(resource).toStrictEqual(expectedCodeSystemsFromDatabaseCopy);

            expect(resource.meta.versionId).toStrictEqual(`${countOfUpdates}`);
            logInfo('finish test: concurrency_issue works with databaseUpdateManager', {});
        });
        test('concurrency_issue works with databaseBulkInserter', async () => {
            logInfo('start test: concurrency_issue works with databaseBulkInserter', {});
            await createTestRequest();
            /**
             * @type {SimpleContainer}
             */
            const container = getTestContainer();
            expect(container).toBeDefined();
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
            await fhirDb.collection(collectionName).deleteMany({});
            expect(await fhirDb.collection(collectionName).countDocuments()).toStrictEqual(0);

            /**
             * @type {FastDatabaseBulkInserter}
             */
            const databaseBulkInserter = container.fastDatabaseBulkInserter;
            expect(databaseBulkInserter).toBeDefined();

            const codesystem1ResourceCopy = deepcopy(codesystem1Resource);
            const countOfUpdates = codesystem1ResourceCopy.length;

            const requestId = '1234';
            const requestInfo = getTestRequestInfo({ requestId });
            const firstCodeSystem = codesystem1ResourceCopy.splice(0, 1)[0];
            await databaseBulkInserter.insertOneAsync({
                base_version,
                requestInfo,
                resourceType: 'CodeSystem',
                doc: toWriteDoc(firstCodeSystem)
            });

            for (const codeSystem of codesystem1ResourceCopy) {
                await databaseBulkInserter.mergeOneAsync(
                    {
                        base_version,
                        requestInfo,
                        resourceType: 'CodeSystem',
                        id: 'medline-loinc-labs',
                        previousVersionId: '1',
                        doc: toWriteDoc(codeSystem),
                        upsert: false,
                        patches: null
                    }
                );
            }
            await databaseBulkInserter.executeAsync({
                requestInfo,
                base_version
            });

            /**
             * @type {PostRequestProcessor}
             */
            const postRequestProcessor = container.postRequestProcessor;
            await postRequestProcessor.executeAsync({ requestId });
            await postRequestProcessor.waitTillDoneAsync({ requestId });

            /**
             * @type {DatabaseQueryFactory}
             */
            const databaseQueryFactory = container.databaseQueryFactory;
            expect(databaseQueryFactory).toBeDefined();

            const databaseQueryManager = databaseQueryFactory.createQuery({
                resourceType: 'CodeSystem',
                base_version: '4_0_0'
            });
            const resource = await readCodeSystemJsonAsync(databaseQueryManager);
            expect(resource.meta.versionId).toStrictEqual('1');
            expect(resource.concept.length).toStrictEqual(countOfUpdates);

            const expectedCodeSystemsFromDatabaseCopy = deepcopy(expectedCodeSystemsFromDatabase);
            expectedCodeSystemsFromDatabaseCopy.meta.versionId = '1';
            expect(resource).toStrictEqual(expectedCodeSystemsFromDatabaseCopy);
            logInfo('finish test: concurrency_issue works with databaseBulkInserter', {});
        });
        test('concurrency_issue works with databaseBulkInserter with insert in the middle', async () => {
            logInfo('start test: concurrency_issue works with databaseBulkInserter with insert in the middle', {});
            await createTestRequest();
            /**
             * @type {SimpleContainer}
             */
            const container = getTestContainer();
            expect(container).toBeDefined();
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
            await fhirDb.collection(collectionName).deleteMany({});
            const codeSystemCollection = fhirDb.collection(collectionName);
            expect(await codeSystemCollection.countDocuments()).toStrictEqual(0);

            /**
             * @type {FastDatabaseBulkInserter}
             */
            const databaseBulkInserter = container.fastDatabaseBulkInserter;
            expect(databaseBulkInserter).toBeDefined();

            const codesystem1ResourceCopy = deepcopy(codesystem1Resource);

            const countOfUpdates = codesystem1ResourceCopy.length;

            const requestId = '9999';
            const requestInfo = getTestRequestInfo({ requestId });
            const firstCodeSystem = codesystem1ResourceCopy.splice(0, 1)[0];
            await databaseBulkInserter.insertOneAsync({
                base_version: '4_0_0',
                requestInfo,
                resourceType: 'CodeSystem',
                doc: toWriteDoc(firstCodeSystem)
            });

            let i = 0;
            for (const codeSystem of codesystem1ResourceCopy) {
                i += 1;
                if (i === 10) {
                    const doc = deepcopy(firstCodeSystem);
                    doc.meta.versionId = '2';
                    await codeSystemCollection.insertOne(doc);
                }
                await databaseBulkInserter.mergeOneAsync(
                    {
                        base_version,
                        requestInfo,
                        resourceType: 'CodeSystem',
                        id: 'medline-loinc-labs',
                        previousVersionId: '1',
                        doc: toWriteDoc(codeSystem),
                        upsert: false,
                        patches: null
                    }
                );
            }

            await databaseBulkInserter.executeAsync({
                requestInfo,
                base_version
            });

            /**
             * @type {PostRequestProcessor}
             */
            const postRequestProcessor = container.postRequestProcessor;
            await postRequestProcessor.executeAsync({ requestId });
            await postRequestProcessor.waitTillDoneAsync({ requestId });

            /**
             * @type {DatabaseQueryFactory}
             */
            const databaseQueryFactory = container.databaseQueryFactory;
            expect(databaseQueryFactory).toBeDefined();

            const databaseQueryManager = databaseQueryFactory.createQuery({
                resourceType: 'CodeSystem',
                base_version: '4_0_0'
            });
            const resource = await readCodeSystemJsonAsync(databaseQueryManager);
            expect(resource.meta.versionId).toStrictEqual('3');
            expect(resource.concept.length).toStrictEqual(countOfUpdates);

            const expectedCodeSystemsFromDatabaseCopy = deepcopy(expectedCodeSystemsFromDatabase);

            expectedCodeSystemsFromDatabaseCopy.meta.versionId = '3';
            expect(resource).toStrictEqual(expectedCodeSystemsFromDatabaseCopy);
            logInfo('finish test: concurrency_issue works with databaseBulkInserter with update in the middle', {});
        });
    });
});
