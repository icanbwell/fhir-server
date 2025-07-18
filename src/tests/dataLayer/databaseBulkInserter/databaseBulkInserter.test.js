const observation = require('./fixtures/observation.json');
const consent = require('./fixtures/consent.json');
const { describe, beforeEach, afterEach, jest, test, expect } = require('@jest/globals');
const { commonBeforeEach, commonAfterEach, getTestRequestInfo } = require('../../common');
const { createTestContainer } = require('../../createTestContainer');
const { ChangeEventProducer } = require('../../../utils/changeEventProducer');
const Observation = require('../../../fhir/classes/4_0_0/resources/observation');
const Consent = require('../../../fhir/classes/4_0_0/resources/consent');
const CodeSystem = require('../../../fhir/classes/4_0_0/resources/codeSystem');
const Meta = require('../../../fhir/classes/4_0_0/complex_types/meta');
const CodeSystemConcept = require('../../../fhir/classes/4_0_0/backbone_elements/codeSystemConcept');
const CodeSystemProperty1 = require('../../../fhir/classes/4_0_0/backbone_elements/codeSystemProperty1');
const BundleEntry = require('../../../fhir/classes/4_0_0/backbone_elements/bundleEntry');
const BundleRequest = require('../../../fhir/classes/4_0_0/backbone_elements/bundleRequest');
const BundleResponse = require('../../../fhir/classes/4_0_0/backbone_elements/bundleResponse');
const OperationOutcome = require('../../../fhir/classes/4_0_0/resources/operationOutcome');
const Coding = require('../../../fhir/classes/4_0_0/complex_types/coding');
const OperationOutcomeIssue = require('../../../fhir/classes/4_0_0/backbone_elements/operationOutcomeIssue');
const { generateUUIDv5 } = require('../../../utils/uid.util');
const Identifier = require('../../../fhir/classes/4_0_0/complex_types/identifier');
const { Collection, MongoInvalidArgumentError } = require('mongodb');
const { DatabaseBulkInserter } = require('../../../dataLayer/databaseBulkInserter');
const { MONGO_ERROR } = require('../../../constants');

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
                doc: new Observation(observation)
            });
            await databaseBulkInserter.insertOneAsync({
                base_version,
                requestInfo,
                resourceType: 'Consent',
                doc: new Consent(consent)
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
                doc: new Observation(observation)
            });
            await databaseBulkInserter.insertOneAsync({
                base_version,
                requestInfo,
                resourceType: 'Consent',
                doc: new Consent(consent)
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
                doc: new Observation(observation)
            });

            await databaseBulkInserter.insertOneAsync({
                base_version,
                requestInfo,
                resourceType: 'Consent',
                doc: new Consent(consent)
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
    describe('databaseBulkInserter CodeSystem concurrency Tests', () => {
        const base_version = '4_0_0';
        test('execAsync works on CodeSystem without concurrency', async () => {
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

            /**
             * @type {DatabaseBulkInserter}
             */
            const databaseBulkInserter = container.databaseBulkInserter;
            const requestId = '1234';
            const userRequestId = '123456';
            const requestInfo = getTestRequestInfo({ requestId, userRequestId });

            const codeSystemOriginal = new CodeSystem({
                id: 'loinc-1',
                status: 'active',
                content: 'complete',
                meta: new Meta({
                    lastUpdated: Date(),
                    versionId: '1'
                }),
                concept: [
                    new CodeSystemConcept(
                        {
                            id: '3565-4',
                            code: '3565-4',
                            property: [
                                new CodeSystemProperty1({
                                    code: 'medline_plus',
                                    valueString: '1'
                                })
                            ]
                        }
                    )
                ]
            });

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
            /**
             * mongo collection
             * @type {import('mongodb').Collection}
             */
            const codeSystemCollection = fhirDb.collection(collectionName);

            await codeSystemCollection.insertOne(codeSystemOriginal.toJSONInternal());

            // add another one
            const codeSystem1 = new CodeSystem({
                id: 'loinc-1',
                _uuid: '93289a07-f21f-514b-9224-532b574c16cd',
                status: 'active',
                content: 'complete',
                meta: new Meta({
                    lastUpdated: Date(),
                    versionId: '2',
                    security: [
                        new Coding({
                            id: "1642e685-6de9-5bdb-89e8-b62ffe4420eb",
                            system: 'https://www.icanbwell.com/owner',
                            code: 'client'
                        }),
                        new Coding({
                            code: 'client',
                            id: "cea955c4-9b2c-5b0d-8b48-acfd40cabb59",
                            system: 'https://www.icanbwell.com/sourceAssigningAuthority'
                        })
                    ]
                }),
                concept: [
                    new CodeSystemConcept(
                        {
                            id: '3565-4',
                            code: '3565-4',
                            property: [
                                new CodeSystemProperty1({
                                    code: 'medline_plus',
                                    valueString: '1'
                                })
                            ]
                        }
                    ),
                    new CodeSystemConcept(
                        {
                            id: '5565-4',
                            code: '5565-4',
                            property: [
                                new CodeSystemProperty1({
                                    code: 'medline_plus',
                                    valueString: '2'
                                })
                            ]
                        }
                    )
                ]
            });
            const updateResult = await codeSystemCollection.findOneAndReplace(
                {
                    id: 'loinc-1'
                },
                codeSystem1.toJSONInternal(),
                { includeResultMetadata: true }
            );
            expect(updateResult.lastErrorObject).toStrictEqual({
                n: 1,
                updatedExisting: true
            });
            const codeSystemsBeforeBulkUpdate = await fhirDb.collection(collectionName).find().toArray();
            expect(codeSystemsBeforeBulkUpdate.length).toStrictEqual(1);
            const expectedCodeSystemAfterFirstUpdate = new CodeSystem({
                id: 'loinc-1',
                status: 'active',
                content: 'complete',
                meta: new Meta({
                    lastUpdated: Date(),
                    versionId: '2',
                    security: [
                        new Coding({
                            id: "1642e685-6de9-5bdb-89e8-b62ffe4420eb",
                            system: 'https://www.icanbwell.com/owner',
                            code: 'client'
                        }),
                        new Coding({
                            code: 'client',
                            id: "cea955c4-9b2c-5b0d-8b48-acfd40cabb59",
                            system: 'https://www.icanbwell.com/sourceAssigningAuthority'
                        })
                    ]
                }),
                concept: [
                    new CodeSystemConcept(
                        {
                            id: '3565-4',
                            code: '3565-4',
                            property: [
                                new CodeSystemProperty1({
                                    code: 'medline_plus',
                                    valueString: '1'
                                })
                            ]
                        }
                    ),
                    new CodeSystemConcept(
                        {
                            id: '5565-4',
                            code: '5565-4',
                            property: [
                                new CodeSystemProperty1({
                                    code: 'medline_plus',
                                    valueString: '2'
                                })
                            ]
                        }
                    )
                ]
            });
            expectedCodeSystemAfterFirstUpdate.meta.lastUpdated = null;
            // noinspection JSCheckFunctionSignatures
            let actualCodeSystem = new CodeSystem(codeSystemsBeforeBulkUpdate[0]);
            actualCodeSystem.meta.lastUpdated = null;
            expect(actualCodeSystem.toJSON()).toStrictEqual(expectedCodeSystemAfterFirstUpdate.toJSON());

            const codeSystem2 = new CodeSystem({
                id: 'loinc-1',
                status: 'active',
                content: 'complete',
                meta: new Meta({
                    lastUpdated: Date(),
                    versionId: '2',
                    source: 'http://www/icanbwell.com',
                    security: [
                        new Coding({
                            system: 'https://www.icanbwell.com/owner',
                            code: 'client'
                        })
                    ]
                }),
                concept: [
                    new CodeSystemConcept(
                        {
                            id: '3565-4',
                            code: '3565-4',
                            property: [
                                new CodeSystemProperty1({
                                    code: 'medline_plus',
                                    valueString: '1'
                                })
                            ]
                        }
                    ),
                    new CodeSystemConcept(
                        {
                            id: '5565-4',
                            code: '5565-4',
                            property: [
                                new CodeSystemProperty1({
                                    code: 'medline_plus',
                                    valueString: '2'
                                })
                            ]
                        }
                    ),
                    new CodeSystemConcept({
                            id: '6665-3',
                            code: '6665-3',
                            property: [
                                new CodeSystemProperty1({
                                    code: 'medline_plus',
                                    valueString: '3'
                                })
                            ]
                        }
                    )
                ]
            });
            await databaseBulkInserter.mergeOneAsync({
                base_version,
                requestInfo,
                resourceType: 'CodeSystem',
                id: codeSystem2.id,
                doc: codeSystem2,
                previousVersionId: '1',
                patches: null
            });

            const codeSystemHistoryEntriesBeforeMerge = await fhirDb.collection(`${collectionName}_History`).find().toArray();
            expect(codeSystemHistoryEntriesBeforeMerge.length).toStrictEqual(0);

            // now execute the bulk inserts
            /**
             * @type {MergeResultEntry[]}
             */
            const mergeResults = await databaseBulkInserter.executeAsync({
                requestInfo,
                base_version
            });
            expect(mergeResults.map(m => m.toJSON())).toStrictEqual([
                {
                    created: false,
                    id: 'loinc-1',
                    resourceType: 'CodeSystem',
                    sourceAssigningAuthority: 'client',
                    updated: true,
                    uuid: '93289a07-f21f-514b-9224-532b574c16cd'
                }
            ]);
            /**
             * @type {PostRequestProcessor}
             */
            const postRequestProcessor = container.postRequestProcessor;
            await postRequestProcessor.executeAsync({ requestId, userRequestId });
            await postRequestProcessor.waitTillDoneAsync({ requestId });

            // check codeSystems
            const codeSystems = await fhirDb.collection(collectionName).find().toArray();
            expect(codeSystems.length).toStrictEqual(1);
            const expectedCodeSystem = new CodeSystem({
                id: 'loinc-1',
                status: 'active',
                content: 'complete',
                meta: new Meta({
                    versionId: '3',
                    source: 'http://www/icanbwell.com',
                    security: [
                        new Coding({
                            id: "1642e685-6de9-5bdb-89e8-b62ffe4420eb",
                            system: 'https://www.icanbwell.com/owner',
                            code: 'client'
                        }),
                        new Coding({
                            code: 'client',
                            id: "cea955c4-9b2c-5b0d-8b48-acfd40cabb59",
                            system: 'https://www.icanbwell.com/sourceAssigningAuthority'
                        })
                    ]
                }),
                identifier: [
                    new Identifier({
                        id: 'sourceId',
                        system: 'https://www.icanbwell.com/sourceId',
                        value: 'loinc-1'
                    }),
                    new Identifier({
                        id: 'uuid',
                        system: 'https://www.icanbwell.com/uuid',
                        value: 'b627381e-4838-46cf-b9b0-02ad7b179219'
                    })
                ],
                concept: [
                    new CodeSystemConcept(
                        {
                            id: '3565-4',
                            code: '3565-4',
                            property: [
                                new CodeSystemProperty1({
                                    code: 'medline_plus',
                                    valueString: '1'
                                })
                            ]
                        }
                    ),
                    new CodeSystemConcept(
                        {
                            id: '5565-4',
                            code: '5565-4',
                            property: [
                                new CodeSystemProperty1({
                                    code: 'medline_plus',
                                    valueString: '2'
                                })
                            ]
                        }
                    ),
                    new CodeSystemConcept(
                        {
                            id: '6665-3',
                            code: '6665-3',
                            property: [
                                new CodeSystemProperty1({
                                    code: 'medline_plus',
                                    valueString: '3'
                                })
                            ]
                        }
                    )
                ]
            });
            // noinspection JSCheckFunctionSignatures
            actualCodeSystem = new CodeSystem(codeSystems[0]);
            actualCodeSystem.meta.lastUpdated = null;
            expectedCodeSystem.meta.lastUpdated = null;
            expectedCodeSystem.identifier[1].value = actualCodeSystem.identifier[1].value;

            expect(actualCodeSystem.toJSON()).toStrictEqual(expectedCodeSystem.toJSON());

            // now check the history table
            const actualCodeSystemHistoryEntries = await fhirDb.collection(`${collectionName}_History`).find().toArray();
            expect(actualCodeSystemHistoryEntries.length).toStrictEqual(1);
            const expectedCodeSystemHistoryEntry = new BundleEntry(
                {
                    id: generateUUIDv5('loinc-1|client'),
                    request: new BundleRequest({
                        id: userRequestId,
                        method: 'POST',
                        url: '/4_0_0/CodeSystem/loinc-1'
                    }),
                    resource: new CodeSystem({
                        id: 'loinc-1',
                        _uuid: '93289a07-f21f-514b-9224-532b574c16cd',
                        status: 'active',
                        content: 'complete',
                        meta: new Meta({
                            versionId: '3',
                            source: 'http://www/icanbwell.com',
                            security: [
                                new Coding({
                                    id: "1642e685-6de9-5bdb-89e8-b62ffe4420eb",
                                    system: 'https://www.icanbwell.com/owner',
                                    code: 'client'
                                }),
                                new Coding({
                                    code: 'client',
                                    id: "cea955c4-9b2c-5b0d-8b48-acfd40cabb59",
                                    system: 'https://www.icanbwell.com/sourceAssigningAuthority'
                                })
                            ]
                        }),
                        identifier: [
                            new Identifier({
                                id: 'sourceId',
                                system: 'https://www.icanbwell.com/sourceId',
                                value: 'loinc-1'
                            }),
                            new Identifier({
                                id: 'uuid',
                                system: 'https://www.icanbwell.com/uuid',
                                value: 'e7f9d7f5-f443-4aa6-aaa8-90bbb676f252'
                            })
                        ],
                        concept: [
                            new CodeSystemConcept(
                                {
                                    id: '3565-4',
                                    code: '3565-4',
                                    property: [
                                        new CodeSystemProperty1({
                                            code: 'medline_plus',
                                            valueString: '1'
                                        })
                                    ]
                                }
                            ),
                            new CodeSystemConcept(
                                {
                                    id: '5565-4',
                                    code: '5565-4',
                                    property: [
                                        new CodeSystemProperty1({
                                            code: 'medline_plus',
                                            valueString: '2'
                                        })
                                    ]
                                }
                            ),
                            new CodeSystemConcept(
                                {
                                    id: '6665-3',
                                    code: '6665-3',
                                    property: [
                                        new CodeSystemProperty1({
                                            code: 'medline_plus',
                                            valueString: '3'
                                        })
                                    ]
                                }
                            )
                        ]
                    }),
                    response: new BundleResponse({
                        outcome: new OperationOutcome({
                            issue: [
                                new OperationOutcomeIssue(
                                    {
                                        code: 'informational',
                                        diagnostics: '{"op":"add","path":"/concept/2","value":{"id":"6665-3","code":"6665-3","property":[{"code":"medline_plus","valueString":"3"}]}}',
                                        severity: 'information'
                                    }
                                ),
                                new OperationOutcomeIssue(
                                    {
                                        code: 'informational',
                                        diagnostics: '{"op":"add","path":"/identifier","value":[{"system":"https://www.icanbwell.com/sourceId","value":"loinc-1"},{"system":"https://www.icanbwell.com/uuid","value":"e7f9d7f5-f443-4aa6-aaa8-90bbb676f252"}]}',
                                        severity: 'information'
                                    }
                                ),
                                new OperationOutcomeIssue(
                                    {
                                        severity: 'information',
                                        code: 'informational',
                                        diagnostics: '{"op":"add","path":"/identifier","value":[{"id":"sourceId","system":"https://www.icanbwell.com/sourceId","value":"loinc-1"},{"id":"uuid","system":"https://www.icanbwell.com/uuid","value":"93289a07-f21f-514b-9224-532b574c16cd"}]}'
                                    }
                                )
                            ],
                            resourceType: 'OperationOutcome'
                        }),
                        status: '200'
                    })
                }
            );
            // noinspection JSCheckFunctionSignatures
            const actualCodeSystemHistoryEntry = new BundleEntry(actualCodeSystemHistoryEntries[0]);
            actualCodeSystemHistoryEntry.resource.meta.lastUpdated = null;
            expectedCodeSystemHistoryEntry.resource.meta.lastUpdated = null;
            expectedCodeSystemHistoryEntry.resource.identifier[1].value = actualCodeSystemHistoryEntry.resource.identifier[1].value;
            expectedCodeSystemHistoryEntry.response.outcome.issue[1].diagnostics = actualCodeSystemHistoryEntry.response.outcome.issue[1].diagnostics;
            expect(actualCodeSystemHistoryEntry).toStrictEqual(expectedCodeSystemHistoryEntry);
        });
        test('execAsync works on CodeSystem with concurrency', async () => {
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

            /**
             * @type {DatabaseBulkInserter}
             */
            const databaseBulkInserter = container.databaseBulkInserter;
            const requestId = '1234';
            const userRequestId = '123456';
            const requestInfo = getTestRequestInfo({ requestId, userRequestId });

            const codeSystemOriginal = new CodeSystem({
                id: 'loinc-1',
                _uuid: generateUUIDv5('loinc-1|client'),
                status: 'active',
                content: 'complete',
                meta: new Meta({
                    lastUpdated: Date(),
                    versionId: '1',
                    source: 'http://www/icanbwell.com',
                    security: [
                        new Coding(
                            {
                                system: 'https://www.icanbwell.com/owner',
                                code: 'client'
                            }
                        )
                    ]
                }),
                concept: [
                    new CodeSystemConcept(
                        {
                            id: '3565-4',
                            code: '3565-4',
                            property: [
                                new CodeSystemProperty1({
                                    code: 'medline_plus',
                                    valueString: '1'
                                })
                            ]
                        }
                    )
                ]
            });

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
            /**
             * mongo collection
             * @type {import('mongodb').Collection}
             */
            const codeSystemCollection = fhirDb.collection(collectionName);

            await codeSystemCollection.insertOne(codeSystemOriginal.toJSONInternal());

            const codeSystem2 = new CodeSystem({
                id: 'loinc-1',
                _uuid: generateUUIDv5('loinc-1|client'),
                status: 'active',
                content: 'complete',
                meta: new Meta({
                    lastUpdated: Date(),
                    versionId: '2',
                    source: 'http://www/icanbwell.com',
                    security: [
                        new Coding({
                            system: 'https://www.icanbwell.com/owner',
                            code: 'client'
                        })
                    ]
                }),
                concept: [
                    new CodeSystemConcept(
                        {
                            id: '6665-3',
                            code: '6665-3',
                            property: [
                                new CodeSystemProperty1({
                                    code: 'medline_plus',
                                    valueString: '3'
                                })
                            ]
                        }
                    )
                ]
            });
            await databaseBulkInserter.mergeOneAsync({
                base_version,
                requestInfo,
                resourceType: 'CodeSystem',
                id: codeSystem2.id,
                doc: codeSystem2,
                previousVersionId: '1',
                patches: null
            });

            // now add in a new one while waiting
            const codeSystem1 = new CodeSystem({
                id: 'loinc-1',
                _uuid: generateUUIDv5('loinc-1|client'),
                status: 'active',
                content: 'complete',
                meta: new Meta({
                    lastUpdated: Date(),
                    versionId: '2',
                    source: 'http://www/icanbwell.com',
                    security: [
                        new Coding({
                            system: 'https://www.icanbwell.com/owner',
                            id: "1642e685-6de9-5bdb-89e8-b62ffe4420eb",
                            code: 'client'
                        }),
                        new Coding({
                            code: 'client',
                            id: "cea955c4-9b2c-5b0d-8b48-acfd40cabb59",
                            system: 'https://www.icanbwell.com/sourceAssigningAuthority'
                        })
                    ]
                }),
                concept: [
                    new CodeSystemConcept(
                        {
                            id: '3565-4',
                            code: '3565-4',
                            property: [
                                new CodeSystemProperty1({
                                    code: 'medline_plus',
                                    valueString: '1'
                                })
                            ]
                        }
                    ),
                    new CodeSystemConcept(
                        {
                            id: '5565-4',
                            code: '5565-4',
                            property: [
                                new CodeSystemProperty1({
                                    code: 'medline_plus',
                                    valueString: '2'
                                })
                            ]
                        }
                    )
                ]
            });
            const updateResult = await codeSystemCollection.findOneAndReplace(
                { id: 'loinc-1' },
                codeSystem1.toJSONInternal(),
                { includeResultMetadata: true }
            );
            expect(updateResult.lastErrorObject).toStrictEqual({
                n: 1,
                updatedExisting: true
            });
            const codeSystemsBeforeBulkUpdate = await fhirDb.collection(collectionName).find().toArray();
            expect(codeSystemsBeforeBulkUpdate.length).toStrictEqual(1);

            const codeSystemHistoryEntriesBeforeUpdate = await fhirDb.collection(`${collectionName}_History`).find().toArray();
            expect(codeSystemHistoryEntriesBeforeUpdate.length).toStrictEqual(0);

            const expectedCodeSystemAfterFirstUpdate = new CodeSystem({
                id: 'loinc-1',
                _uuid: generateUUIDv5('loinc-1|client'),
                status: 'active',
                content: 'complete',
                meta: new Meta({
                    lastUpdated: Date(),
                    versionId: '2',
                    source: 'http://www/icanbwell.com',
                    security: [
                        new Coding({
                            system: 'https://www.icanbwell.com/owner',
                            id: "1642e685-6de9-5bdb-89e8-b62ffe4420eb",
                            code: 'client'
                        }),
                        new Coding({
                            code: 'client',
                            id: "cea955c4-9b2c-5b0d-8b48-acfd40cabb59",
                            system: 'https://www.icanbwell.com/sourceAssigningAuthority'
                        })
                    ]
                }),
                concept: [
                    new CodeSystemConcept(
                        {
                            id: '3565-4',
                            code: '3565-4',
                            property: [
                                new CodeSystemProperty1({
                                    code: 'medline_plus',
                                    valueString: '1'
                                })
                            ]
                        }
                    ),
                    new CodeSystemConcept(
                        {
                            id: '5565-4',
                            code: '5565-4',
                            property: [
                                new CodeSystemProperty1({
                                    code: 'medline_plus',
                                    valueString: '2'
                                })
                            ]
                        }
                    )
                ]
            });
            expectedCodeSystemAfterFirstUpdate.meta.lastUpdated = null;
            // noinspection JSCheckFunctionSignatures
            let actualCodeSystem = new CodeSystem(codeSystemsBeforeBulkUpdate[0]);
            actualCodeSystem.meta.lastUpdated = null;
            expect(actualCodeSystem.toJSON()).toStrictEqual(expectedCodeSystemAfterFirstUpdate.toJSON());

            // now execute the bulk inserts
            /**
             * @type {MergeResultEntry[]}
             */
            const mergeResults = await databaseBulkInserter.executeAsync({
                requestInfo,
                base_version
            });
            expect(mergeResults.map(m => m.toJSON())).toStrictEqual([
                {
                    id: 'loinc-1',
                    created: false,
                    resourceType: 'CodeSystem',
                    sourceAssigningAuthority: 'client',
                    updated: true,
                    uuid: '93289a07-f21f-514b-9224-532b574c16cd'
                }
            ]);
            /**
             * @type {PostRequestProcessor}
             */
            const postRequestProcessor = container.postRequestProcessor;
            await postRequestProcessor.executeAsync({ requestId, userRequestId });
            await postRequestProcessor.waitTillDoneAsync({ requestId });

            // check codeSystems
            const codeSystems = await fhirDb.collection(collectionName).find().toArray();
            expect(codeSystems.length).toStrictEqual(1);
            const expectedCodeSystem = new CodeSystem({
                _uuid: generateUUIDv5('loinc-1|client'),
                id: 'loinc-1',
                status: 'active',
                content: 'complete',
                meta: new Meta({
                    versionId: '3',
                    source: 'http://www/icanbwell.com',
                    security: [
                        new Coding({
                            system: 'https://www.icanbwell.com/owner',
                            id: "1642e685-6de9-5bdb-89e8-b62ffe4420eb",
                            code: 'client'
                        }),
                        new Coding({
                            code: 'client',
                            id: "cea955c4-9b2c-5b0d-8b48-acfd40cabb59",
                            system: 'https://www.icanbwell.com/sourceAssigningAuthority'
                        })
                    ]
                }),
                identifier: [
                    new Identifier({
                        id: 'sourceId',
                        system: 'https://www.icanbwell.com/sourceId',
                        value: 'loinc-1'
                    }),
                    new Identifier({
                        id: 'uuid',
                        system: 'https://www.icanbwell.com/uuid',
                        value: '30567620-6073-44c1-b77a-83cb11fc971e'
                    })
                ],
                concept: [
                    new CodeSystemConcept(
                        {
                            id: '3565-4',
                            code: '3565-4',
                            property: [
                                new CodeSystemProperty1({
                                    code: 'medline_plus',
                                    valueString: '1'
                                })
                            ]
                        }
                    ),
                    new CodeSystemConcept(
                        {
                            id: '5565-4',
                            code: '5565-4',
                            property: [
                                new CodeSystemProperty1({
                                    code: 'medline_plus',
                                    valueString: '2'
                                })
                            ]
                        }
                    ),
                    new CodeSystemConcept(
                        {
                            id: '6665-3',
                            code: '6665-3',
                            property: [
                                new CodeSystemProperty1({
                                    code: 'medline_plus',
                                    valueString: '3'
                                })
                            ]
                        }
                    )
                ]
            });
            // noinspection JSCheckFunctionSignatures
            actualCodeSystem = new CodeSystem(codeSystems[0]);
            actualCodeSystem.meta.lastUpdated = null;
            expectedCodeSystem.meta.lastUpdated = null;
            expectedCodeSystem.identifier[1].value = actualCodeSystem.identifier[1].value;

            expect(actualCodeSystem.toJSON()).toStrictEqual(expectedCodeSystem.toJSON());

            // now check the history table
            const actualCodeSystemHistoryEntries = await fhirDb.collection(`${collectionName}_History`).find().toArray();
            expect(actualCodeSystemHistoryEntries.length).toStrictEqual(1);
            const expectedCodeSystemHistoryEntry = new BundleEntry(
                {
                    id: generateUUIDv5('loinc-1|client'),
                    request: new BundleRequest({
                        id: userRequestId,
                        method: 'POST',
                        url: '/4_0_0/CodeSystem/loinc-1'
                    }),
                    resource: new CodeSystem({
                        id: 'loinc-1',
                        _uuid: generateUUIDv5('loinc-1|client'),
                        status: 'active',
                        content: 'complete',
                        meta: new Meta({
                            versionId: '3',
                            source: 'http://www/icanbwell.com',
                            security: [
                                new Coding({
                                    system: 'https://www.icanbwell.com/owner',
                                    id: "1642e685-6de9-5bdb-89e8-b62ffe4420eb",
                                    code: 'client'
                                }),
                                new Coding({
                                    code: 'client',
                                    id: "cea955c4-9b2c-5b0d-8b48-acfd40cabb59",
                                    system: 'https://www.icanbwell.com/sourceAssigningAuthority'
                                })
                            ]
                        }),
                        identifier: [
                            new Identifier({
                                id: 'sourceId',
                                system: 'https://www.icanbwell.com/sourceId',
                                value: 'loinc-1'
                            }),
                            new Identifier({
                                id: 'uuid',
                                system: 'https://www.icanbwell.com/uuid',
                                value: 'f67ac4cf-d135-46ac-b23d-a16289a61074'
                            })
                        ],
                        concept: [
                            new CodeSystemConcept(
                                {
                                    id: '3565-4',
                                    code: '3565-4',
                                    property: [
                                        new CodeSystemProperty1({
                                            code: 'medline_plus',
                                            valueString: '1'
                                        })
                                    ]
                                }
                            ),
                            new CodeSystemConcept(
                                {
                                    id: '5565-4',
                                    code: '5565-4',
                                    property: [
                                        new CodeSystemProperty1({
                                            code: 'medline_plus',
                                            valueString: '2'
                                        })
                                    ]
                                }
                            ),
                            new CodeSystemConcept(
                                {
                                    id: '6665-3',
                                    code: '6665-3',
                                    property: [
                                        new CodeSystemProperty1({
                                            code: 'medline_plus',
                                            valueString: '3'
                                        })
                                    ]
                                }
                            )
                        ]
                    }),
                    response: new BundleResponse({
                        outcome: new OperationOutcome({
                            issue: [
                                new OperationOutcomeIssue(
                                    {
                                        code: 'informational',
                                        diagnostics: '{"op":"add","path":"/concept/2","value":{"id":"6665-3","code":"6665-3","property":[{"code":"medline_plus","valueString":"3"}]}}',
                                        severity: 'information'
                                    }
                                ),
                                new OperationOutcomeIssue(
                                    {
                                        code: 'informational',
                                        diagnostics: '{"op":"add","path":"/identifier","value":[{"system":"https://www.icanbwell.com/sourceId","value":"loinc-1"},{"system":"https://www.icanbwell.com/uuid","value":"f67ac4cf-d135-46ac-b23d-a16289a61074"}]}',
                                        severity: 'information'
                                    }
                                ),
                                new OperationOutcomeIssue(
                                    {
                                        code: 'informational',
                                        diagnostics: '{"op":"add","path":"/identifier","value":[{"id":"sourceId","system":"https://www.icanbwell.com/sourceId","value":"loinc-1"},{"id":"uuid","system":"https://www.icanbwell.com/uuid","value":"93289a07-f21f-514b-9224-532b574c16cd"}]}',
                                        severity: 'information'
                                    }
                                )
                            ],
                            resourceType: 'OperationOutcome'
                        }),
                        status: '200'
                    })
                }
            );
            // noinspection JSCheckFunctionSignatures
            const actualCodeSystemHistoryEntry = new BundleEntry(actualCodeSystemHistoryEntries[0]);
            actualCodeSystemHistoryEntry.resource.meta.lastUpdated = null;
            expectedCodeSystemHistoryEntry.resource.meta.lastUpdated = null;
            expectedCodeSystemHistoryEntry.resource.identifier[1].value = actualCodeSystemHistoryEntry.resource.identifier[1].value;
            expectedCodeSystemHistoryEntry.response.outcome.issue[1].diagnostics = actualCodeSystemHistoryEntry.response.outcome.issue[1].diagnostics;
            expect(actualCodeSystemHistoryEntry).toStrictEqual(expectedCodeSystemHistoryEntry);
        });
        test('execAsync works on CodeSystem with multiple inserts and replace on same id', async () => {
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

            /**
             * @type {DatabaseBulkInserter}
             */
            const databaseBulkInserter = container.databaseBulkInserter;
            const requestId = '1234';

            const codeSystemOriginal = new CodeSystem({
                id: 'loinc-1',
                status: 'active',
                content: 'complete',
                meta: new Meta({
                    lastUpdated: Date(),
                    versionId: '1',
                    source: 'http://www/icanbwell.com',
                    security: [
                        new Coding({
                            system: 'https://www.icanbwell.com/owner',
                            code: 'client'
                        })
                    ]
                }),
                concept: [
                    new CodeSystemConcept(
                        {
                            id: '3565-4',
                            code: '3565-4',
                            property: [
                                new CodeSystemProperty1({
                                    code: 'medline_plus',
                                    valueString: '1'
                                })
                            ]
                        }
                    )
                ]
            });

            // now add in a new one while waiting
            const codeSystem1 = new CodeSystem({
                id: 'loinc-1',
                status: 'active',
                content: 'complete',
                meta: new Meta({
                    lastUpdated: Date(),
                    versionId: '1',
                    source: 'http://www/icanbwell.com',
                    security: [
                        new Coding({
                            system: 'https://www.icanbwell.com/owner',
                            code: 'client'
                        })
                    ]
                }),
                concept: [
                    new CodeSystemConcept(
                        {
                            id: '5565-4',
                            code: '5565-4',
                            property: [
                                new CodeSystemProperty1({
                                    code: 'medline_plus',
                                    valueString: '2'
                                })
                            ]
                        }
                    )
                ]
            });

            const codeSystem2 = new CodeSystem({
                id: 'loinc-1',
                status: 'active',
                content: 'complete',
                meta: new Meta({
                    lastUpdated: Date(),
                    versionId: '1',
                    source: 'http://www/icanbwell.com',
                    security: [
                        new Coding({
                            system: 'https://www.icanbwell.com/owner',
                            code: 'client'
                        })
                    ]
                }),
                concept: [
                    new CodeSystemConcept(
                        {
                            id: '6665-3',
                            code: '6665-3',
                            property: [
                                new CodeSystemProperty1({
                                    code: 'medline_plus',
                                    valueString: '3'
                                })
                            ]
                        }
                    )
                ]
            });
            const requestInfo = getTestRequestInfo({ requestId });

            await databaseBulkInserter.insertOneAsync({
                base_version,
                requestInfo,
                resourceType: 'CodeSystem',
                doc: codeSystemOriginal
            });

            await databaseBulkInserter.insertOneAsync({
                base_version,
                requestInfo,
                resourceType: 'CodeSystem',
                doc: codeSystem1
            });

            await databaseBulkInserter.mergeOneAsync({
                base_version,
                requestInfo,
                resourceType: 'CodeSystem',
                doc: codeSystem2,
                previousVersionId: null,
                patches: null
            });

            // now execute the bulk inserts
            /**
             * @type {MergeResultEntry[]}
             */
            const mergeResults = await databaseBulkInserter.executeAsync({
                requestInfo,
                base_version
            });
            expect(mergeResults.map(m => m.toJSON())).toStrictEqual([
                {
                    created: true,
                    id: 'loinc-1',
                    resourceType: 'CodeSystem',
                    sourceAssigningAuthority: 'client',
                    updated: false,
                    uuid: '93289a07-f21f-514b-9224-532b574c16cd'
                }
            ]);
            /**
             * @type {PostRequestProcessor}
             */
            const postRequestProcessor = container.postRequestProcessor;
            await postRequestProcessor.executeAsync({ requestId });
            await postRequestProcessor.waitTillDoneAsync({ requestId });

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

            const codeSystems = await fhirDb.collection(collectionName).find().toArray();
            expect(codeSystems.length).toStrictEqual(1);
            const expectedCodeSystem = new CodeSystem({
                id: 'loinc-1',
                status: 'active',
                content: 'complete',
                meta: new Meta({
                    versionId: '1',
                    source: 'http://www/icanbwell.com',
                    security: [
                        new Coding({
                            system: 'https://www.icanbwell.com/owner',
                            id: "1642e685-6de9-5bdb-89e8-b62ffe4420eb",
                            code: 'client'
                        }),
                        new Coding({
                            code: 'client',
                            id: "cea955c4-9b2c-5b0d-8b48-acfd40cabb59",
                            system: 'https://www.icanbwell.com/sourceAssigningAuthority'
                        })
                    ]
                }),
                identifier: [
                    new Identifier({
                        id: 'sourceId',
                        system: 'https://www.icanbwell.com/sourceId',
                        value: 'loinc-1'
                    }),
                    new Identifier({
                        id: 'uuid',
                        system: 'https://www.icanbwell.com/uuid',
                        value: '946e32d8-2645-4d3c-8fac-5fd96ee3a29c'
                    })
                ],
                concept: [
                    new CodeSystemConcept(
                        {
                            id: '3565-4',
                            code: '3565-4',
                            property: [
                                new CodeSystemProperty1({
                                    code: 'medline_plus',
                                    valueString: '1'
                                })
                            ]
                        }
                    ),
                    new CodeSystemConcept(
                        {
                            id: '5565-4',
                            code: '5565-4',
                            property: [
                                new CodeSystemProperty1({
                                    code: 'medline_plus',
                                    valueString: '2'
                                })
                            ]
                        }
                    ),
                    new CodeSystemConcept(
                        {
                            id: '6665-3',
                            code: '6665-3',
                            property: [
                                new CodeSystemProperty1({
                                    code: 'medline_plus',
                                    valueString: '3'
                                })
                            ]
                        }
                    )
                ]
            });
            // noinspection JSCheckFunctionSignatures
            const actualCodeSystem = new CodeSystem(codeSystems[0]);
            actualCodeSystem.meta.lastUpdated = null;
            expectedCodeSystem.meta.lastUpdated = null;
            expectedCodeSystem.identifier[1].value = actualCodeSystem.identifier[1].value;

            expect(actualCodeSystem.toJSON()).toStrictEqual(expectedCodeSystem.toJSON());
        });
        test('execAsync works on CodeSystem with multiple inserts with same resource', async () => {
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

            /**
             * @type {DatabaseBulkInserter}
             */
            const databaseBulkInserter = container.databaseBulkInserter;
            const requestId = '1234';
            const requestInfo = getTestRequestInfo({ requestId });

            const codeSystemOriginal = new CodeSystem({
                id: 'loinc-1',
                status: 'active',
                content: 'complete',
                meta: new Meta({
                    lastUpdated: Date(),
                    versionId: '1',
                    source: 'http://www/icanbwell.com',
                    security: [
                        new Coding({
                            system: 'https://www.icanbwell.com/owner',
                            code: 'client'
                        })
                    ]
                }),
                concept: [
                    new CodeSystemConcept(
                        {
                            id: '3565-4',
                            code: '3565-4',
                            property: [
                                new CodeSystemProperty1({
                                    code: 'medline_plus',
                                    valueString: '1'
                                })
                            ]
                        }
                    )
                ]
            });

            await databaseBulkInserter.insertOneAsync({
                base_version,
                requestInfo,
                resourceType: 'CodeSystem',
                doc: codeSystemOriginal
            });

            await databaseBulkInserter.insertOneAsync({
                base_version,
                requestInfo,
                resourceType: 'CodeSystem',
                doc: codeSystemOriginal
            });

            await databaseBulkInserter.mergeOneAsync({
                base_version,
                requestInfo,
                id: codeSystemOriginal.id,
                resourceType: 'CodeSystem',
                doc: codeSystemOriginal,
                previousVersionId: null,
                patches: null
            });

            // now execute the bulk inserts
            /**
             * @type {MergeResultEntry[]}
             */
            const mergeResults = await databaseBulkInserter.executeAsync({
                requestInfo,
                base_version
            });
            expect(mergeResults.map(m => m.toJSON())).toStrictEqual([
                {
                    created: true,
                    id: 'loinc-1',
                    resourceType: 'CodeSystem',
                    sourceAssigningAuthority: 'client',
                    updated: false,
                    uuid: '93289a07-f21f-514b-9224-532b574c16cd'
                }
            ]);
            /**
             * @type {PostRequestProcessor}
             */
            const postRequestProcessor = container.postRequestProcessor;
            await postRequestProcessor.executeAsync({ requestId });
            await postRequestProcessor.waitTillDoneAsync({ requestId });

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

            const codeSystems = await fhirDb.collection(collectionName).find().toArray();
            expect(codeSystems.length).toStrictEqual(1);
            const expectedCodeSystem = new CodeSystem({
                concept: [
                    new CodeSystemConcept({
                        code: '3565-4',
                        id: '3565-4',
                        property: [
                            new CodeSystemProperty1({
                                code: 'medline_plus',
                                valueString: '1'
                            })
                        ]
                    })
                ],
                content: 'complete',
                id: 'loinc-1',
                meta: new Meta({
                    versionId: '1',
                    source: 'http://www/icanbwell.com',
                    security: [
                        new Coding(
                            {
                                system: 'https://www.icanbwell.com/owner',
                                id: "1642e685-6de9-5bdb-89e8-b62ffe4420eb",
                                code: 'client'
                            }
                        ),
                        new Coding(
                            {
                                code: 'client',
                                id: "cea955c4-9b2c-5b0d-8b48-acfd40cabb59",
                                system: 'https://www.icanbwell.com/sourceAssigningAuthority'
                            }
                        )
                    ]
                }),
                identifier: [
                    new Identifier({
                        id: 'sourceId',
                        system: 'https://www.icanbwell.com/sourceId',
                        value: 'loinc-1'
                    }),
                    new Identifier({
                        id: 'uuid',
                        system: 'https://www.icanbwell.com/uuid',
                        value: 'd05fce76-7645-41f0-968a-9b42dd579a6d'
                    })
                ],
                resourceType: 'CodeSystem',
                status: 'active'
            });
            // noinspection JSCheckFunctionSignatures
            const actualCodeSystem = new CodeSystem(codeSystems[0]);
            actualCodeSystem.meta.lastUpdated = null;
            expectedCodeSystem.meta.lastUpdated = null;
            expectedCodeSystem.identifier[1].value = actualCodeSystem.identifier[1].value;

            expect(actualCodeSystem.toJSON()).toStrictEqual(expectedCodeSystem.toJSON());
        });
    });
});
