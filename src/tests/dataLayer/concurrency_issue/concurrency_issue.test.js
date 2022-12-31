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

describe('CodeSystem Tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('CodeSystem concurrency_issue Tests', () => {
        test('concurrency_issue works', async () => {
            const request = await createTestRequest();
            // ARRANGE
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

            // ACT & ASSERT
            // search by token system and code and make sure we get the right CodeSystem back
            let resp = await request
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

        });
        test('concurrency_issue works with databaseUpdateManager', async () => {
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
            expectedCodeSystemsFromDatabase.meta.versionId = '29'; // in case of databaseUpdateManager we expect the versionId to increment
            expect(resource.toJSON()).toStrictEqual(expectedCodeSystemsFromDatabase);

            expect(resource.toJSON().meta.versionId).toStrictEqual(`${countOfUpdates}`);
        });
        test('concurrency_issue works with databaseBulkInserter', async () => {
            await createTestRequest();
            /**
             * @type {SimpleContainer}
             */
            const container = getTestContainer();

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
                await databaseBulkInserter.replaceOneAsync(
                    {
                        requestId,
                        resourceType: 'CodeSystem',
                        id: 'medline-loinc-labs',
                        previousVersionId: '1',
                        doc: new CodeSystem(codeSystem),
                        upsert: false
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
                base_version: '4_0_0'
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

            expect(resource.toJSON()).toStrictEqual(expectedCodeSystemsFromDatabase);
        });
    });
});
