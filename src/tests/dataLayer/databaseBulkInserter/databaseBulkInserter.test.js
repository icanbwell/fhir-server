const observation = require('./fixtures/observation.json');
const consent = require('./fixtures/consent.json');
const { describe, beforeEach, afterEach, jest, test, expect } = require('@jest/globals');
const { commonBeforeEach, commonAfterEach, getTestRequestInfo } = require('../../common');
const { createTestContainer } = require('../../createTestContainer');
const { ChangeEventProducer } = require('../../../utils/changeEventProducer');
const Observation = require('../../../fhir/classes/4_0_0/resources/observation');
const Consent = require('../../../fhir/classes/4_0_0/resources/consent');
const { Collection, MongoInvalidArgumentError } = require('mongodb');
const { DatabaseBulkInserter } = require('../../../dataLayer/databaseBulkInserter');
const { MONGO_ERROR } = require('../../../constants');

const observationObject = new Observation(observation);
const consentObject = new Consent(consent);

class MockChangeEventProducer extends ChangeEventProducer {
    /**
     * Constructor
     * @param {KafkaClient} kafkaClient
     * @param {ResourceManager} resourceManager
     * @param {string} fhirResourceChangeTopic
     * @param {RequestSpecificCache} requestSpecificCache
     * @param {ConfigManager} configManager
     */
    constructor ({
                    kafkaClient,
                    resourceManager,
                    fhirResourceChangeTopic,
                    requestSpecificCache,
                    configManager
                }) {
        super({
            kafkaClient,
            resourceManager,
            fhirResourceChangeTopic,
            requestSpecificCache,
            configManager
        });
    }
}

describe('databaseBulkInserter Tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
        jest.restoreAllMocks();
    });

    afterEach(async () => {
        await commonAfterEach();
    });
    describe('databaseBulkInserter Tests', () => {
        const base_version = '4_0_0';
        test('execAsync works', async () => {
            const container = createTestContainer((container1) => {
                container1.register(
                    'changeEventProducer',
                    (c) =>
                        new MockChangeEventProducer({
                            kafkaClient: c.kafkaClient,
                            resourceManager: c.resourceManager,
                            fhirResourceChangeTopic: process.env.KAFKA_RESOURCE_CHANGE_TOPIC || 'business.events',
                            configManager: c.configManager,
                            requestSpecificCache: c.requestSpecificCache
                        })
                );
                return container1;
            });

            // noinspection JSCheckFunctionSignatures
            const onResourceCreateAsync = jest
                .spyOn(MockChangeEventProducer.prototype, 'onResourceCreateAsync')
                .mockImplementation(() => {
                });
            // noinspection JSCheckFunctionSignatures
            const onResourceChangeAsync = jest
                .spyOn(MockChangeEventProducer.prototype, 'onResourceChangeAsync')
                .mockImplementation(() => {
                });
            /**
             * @type {DatabaseBulkInserter}
             */
            const databaseBulkInserter = container.databaseBulkInserter;
            const requestId = '1234';
            const requestInfo = getTestRequestInfo({ requestId });

            await databaseBulkInserter.insertOneAsync({
                base_version,
                requestInfo,
                resourceType: 'Observation',
                doc: observationObject
            });
            await databaseBulkInserter.insertOneAsync({
                base_version,
                requestInfo,
                resourceType: 'Consent',
                doc: consentObject
            });

            // now execute the bulk inserts
            /**
             * @type {MergeResultEntry[]}
             */
            const mergeResults = await databaseBulkInserter.executeAsync({
                requestInfo,
                base_version
            });

            expect(mergeResults.length).toStrictEqual(2);
            expect(mergeResults[0].created).toStrictEqual(true);
            expect(mergeResults[1].created).toStrictEqual(true);

            /**
             * @type {PostRequestProcessor}
             */
            const postRequestProcessor = container.postRequestProcessor;
            await postRequestProcessor.executeAsync({ requestId });
            await postRequestProcessor.waitTillAllRequestsDoneAsync({ timeoutInSeconds: 20 });

            /**
             * @type {MongoDatabaseManager}
             */
            const mongoDatabaseManager = container.mongoDatabaseManager;
            /**
             * mongo connection
             * @type {import('mongodb').Db}
             */
            const fhirDb = await mongoDatabaseManager.getClientDbAsync();
            // check observations
            const observationCollection = `Observation_${base_version}`;
            const observations = await fhirDb.collection(observationCollection).find().toArray();
            expect(observations.length).toStrictEqual(1);
            expect(observations[0].id).toStrictEqual('2354-InAgeCohort');

            expect(onResourceCreateAsync).toBeCalledTimes(1);
            expect(onResourceChangeAsync).toBeCalledTimes(0);
        });

        test('execAsync handles mongo error', async () => {
            const container = createTestContainer((container1) => {
                container1.register(
                    'changeEventProducer',
                    (c) =>
                        new MockChangeEventProducer({
                            kafkaClient: c.kafkaClient,
                            resourceManager: c.resourceManager,
                            fhirResourceChangeTopic: process.env.KAFKA_RESOURCE_CHANGE_TOPIC || 'business.events',
                            configManager: c.configManager,
                            requestSpecificCache: c.requestSpecificCache
                        })
                );
                return container1;
            });

            // noinspection JSCheckFunctionSignatures
            const onResourceCreateAsync = jest
                .spyOn(MockChangeEventProducer.prototype, 'onResourceCreateAsync')
                .mockImplementation(() => {
                });
            // noinspection JSCheckFunctionSignatures
            const onResourceChangeAsync = jest
                .spyOn(MockChangeEventProducer.prototype, 'onResourceChangeAsync')
                .mockImplementation(() => {
                });
            /**
             * @type {MongoDatabaseManager}
             */
            const mongoDatabaseManager = container.mongoDatabaseManager;
            /**
             * mongo connection
             * @type {import('mongodb').Db}
             */
            const fhirDb = await mongoDatabaseManager.getClientDbAsync();
            const base_version = '4_0_0';
            // noinspection JSCheckFunctionSignatures
            jest
                .spyOn(Collection.prototype, 'bulkWrite')
                .mockImplementation(() => {
                    const result = {
                        nMatched: 1,
                        nUpserted: 1,
                        hasWriteErrors: () => true,
                        getWriteErrors: () => [
                            {
                                code: 1,
                                index: 1,
                                errMsg: 'Error msg test',
                                toJSON: () => JSON.parse('{"code": 1, "index": 1, "errMsg": "Error msg test"}')
                            }
                        ]
                    };
                    return result;
                });
            /**
             * @type {DatabaseBulkInserter}
             */
            const databaseBulkInserter = container.databaseBulkInserter;
            const requestId = '1234';
            const requestInfo = getTestRequestInfo({ requestId });

            await databaseBulkInserter.insertOneAsync({
                base_version,
                requestInfo,
                resourceType: 'Observation',
                doc: observationObject
            });
            await databaseBulkInserter.insertOneAsync({
                base_version,
                requestInfo,
                resourceType: 'Consent',
                doc: consentObject
            });

            // now execute the bulk inserts
            const result = await databaseBulkInserter.executeAsync({
                requestInfo,
                base_version
            });

            /**
             * @type {PostRequestProcessor}
             */
            const postRequestProcessor = container.postRequestProcessor;
            await postRequestProcessor.executeAsync({ requestId });
            await postRequestProcessor.waitTillDoneAsync({ requestId });

            // Check the result has errors
            expect(result).not.toBeNull();
            expect(result.length).toBeGreaterThanOrEqual(2);

            // check observations
            const observationCollection = `Observation_${base_version}`;
            const observations = await fhirDb.collection(observationCollection).find().toArray();
            expect(observations.length).toStrictEqual(0);

            expect(onResourceCreateAsync).toBeCalledTimes(1);
            expect(onResourceChangeAsync).toBeCalledTimes(0);
        });

        test('execAsync handles thrown mongo error', async () => {
            const container = createTestContainer((container1) => {
                container1.register(
                    'changeEventProducer',
                    (c) =>
                        new MockChangeEventProducer({
                            kafkaClient: c.kafkaClient,
                            resourceManager: c.resourceManager,
                            fhirResourceChangeTopic:
                                process.env.KAFKA_RESOURCE_CHANGE_TOPIC || 'business.events',
                            configManager: c.configManager,
                            requestSpecificCache: c.requestSpecificCache
                        })
                );
                return container1;
            });

            // noinspection JSCheckFunctionSignatures
            const onResourceCreateAsync = jest
                .spyOn(MockChangeEventProducer.prototype, 'onResourceCreateAsync')
                .mockImplementation(() => {});
            // noinspection JSCheckFunctionSignatures
            const onResourceChangeAsync = jest
                .spyOn(MockChangeEventProducer.prototype, 'onResourceChangeAsync')
                .mockImplementation(() => {});
            /**
             * @type {MongoDatabaseManager}
             */
            const mongoDatabaseManager = container.mongoDatabaseManager;
            /**
             * mongo connection
             * @type {import('mongodb').Db}
             */
            const fhirDb = await mongoDatabaseManager.getClientDbAsync();
            const base_version = '4_0_0';
            // noinspection JSCheckFunctionSignatures
            const mockBulkWrite = jest.spyOn(Collection.prototype, 'bulkWrite');

            mockBulkWrite.mockImplementation((operations) => {
                throw new MongoInvalidArgumentError(MONGO_ERROR.RESOURCE_SIZE_EXCEEDS);
            });

            /**
             * @type {DatabaseBulkInserter}
             */
            const databaseBulkInserter = container.databaseBulkInserter;
            const requestId = '1234';
            const requestInfo = getTestRequestInfo({ requestId });

            await databaseBulkInserter.insertOneAsync({
                base_version,
                requestInfo,
                resourceType: 'Observation',
                doc: observationObject
            });

            await databaseBulkInserter.insertOneAsync({
                base_version,
                requestInfo,
                resourceType: 'Consent',
                doc: consentObject
            });

            // now execute the bulk inserts
            const result = await databaseBulkInserter.executeAsync({
                requestInfo,
                base_version
            });

            /**
             * @type {PostRequestProcessor}
             */
            const postRequestProcessor = container.postRequestProcessor;
            await postRequestProcessor.executeAsync({ requestId });
            await postRequestProcessor.waitTillDoneAsync({ requestId });

            // Check the result has errors
            expect(result).not.toBeNull();
            expect(result.length).toBeGreaterThanOrEqual(2);
            expect(result.map((r) => r.toJSON())).toMatchObject([
                {
                    issue: {
                        severity: 'error',
                        code: 'exception',
                        details: {
                            text: 'Error in one of the resources of Observation: MongoInvalidArgumentError: Document is larger than the maximum size 16777216'
                        },
                        diagnostics:
                            'Error in one of the resources of Observation: MongoInvalidArgumentError: Document is larger than the maximum size 16777216'
                    },
                    created: false,
                    id: '2354-InAgeCohort',
                    uuid: 'c5678da4-227a-5d46-9498-58f992804404',
                    resourceType: 'Observation',
                    updated: false,
                    sourceAssigningAuthority: 'A'
                },
                {
                    issue: {
                        severity: 'error',
                        code: 'exception',
                        details: {
                            text: 'Error in one of the resources of Consent: MongoInvalidArgumentError: Document is larger than the maximum size 16777216'
                        },
                        diagnostics:
                            'Error in one of the resources of Consent: MongoInvalidArgumentError: Document is larger than the maximum size 16777216'
                    },
                    created: false,
                    id: '1167dbd7-b5de-4843-b3aa-3804b28a7573',
                    uuid: '1167dbd7-b5de-4843-b3aa-3804b28a7573',
                    resourceType: 'Consent',
                    updated: false,
                    sourceAssigningAuthority: 'client'
                }
            ]);
            // check observations
            const observationCollection = `Observation_${base_version}`;
            const observations = await fhirDb.collection(observationCollection).find().toArray();
            expect(observations.length).toStrictEqual(0);

            expect(onResourceCreateAsync).toBeCalledTimes(0);
            expect(onResourceChangeAsync).toBeCalledTimes(0);
            expect(mockBulkWrite).toHaveBeenCalledTimes(2);
        });
    });
});
