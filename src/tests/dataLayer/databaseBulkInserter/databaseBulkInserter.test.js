/* eslint-disable no-unused-vars */

const patient = require('./fixtures/patient.json');
const bwellPerson = require('./fixtures/bwellPerson.json');
const clientPerson = require('./fixtures/clientPerson.json');
const observation = require('./fixtures/observation.json');
const consent = require('./fixtures/consent.json');
const {describe, beforeEach, afterEach, jest, test, expect} = require('@jest/globals');
const moment = require('moment-timezone');
const {commonBeforeEach, commonAfterEach} = require('../../common');
const {createTestContainer} = require('../../createTestContainer');
const {ChangeEventProducer} = require('../../../utils/changeEventProducer');
const env = require('var');
const Patient = require('../../../fhir/classes/4_0_0/resources/patient');
const Person = require('../../../fhir/classes/4_0_0/resources/person');
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
const {generateUUIDv5} = require('../../../utils/uid.util');
const Identifier = require('../../../fhir/classes/4_0_0/complex_types/identifier');
const {Collection} = require('mongodb');

class MockChangeEventProducer extends ChangeEventProducer {
    /**
     * Constructor
     * @param {KafkaClient} kafkaClient
     * @param {ResourceManager} resourceManager
     * @param {string} patientChangeTopic
     * @param {string} consentChangeTopic
     * @param {BwellPersonFinder} bwellPersonFinder
     * @param {RequestSpecificCache} requestSpecificCache
     * @param {ConfigManager} configManager
     */
    constructor({
                    kafkaClient,
                    resourceManager,
                    patientChangeTopic,
                    consentChangeTopic,
                    bwellPersonFinder,
                    requestSpecificCache,
                    configManager
                }) {
        super({
            kafkaClient,
            resourceManager,
            patientChangeTopic,
            consentChangeTopic,
            bwellPersonFinder,
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
        test('execAsync works', async () => {
            /**
             * @type {string}
             */
            const currentDate = moment.utc().format('YYYY-MM-DD');

            const container = createTestContainer((container1) => {
                container1.register(
                    'changeEventProducer',
                    (c) =>
                        new MockChangeEventProducer({
                            kafkaClient: c.kafkaClient,
                            resourceManager: c.resourceManager,
                            patientChangeTopic: env.KAFKA_PATIENT_CHANGE_TOPIC || 'business.events',
                            consentChangeTopic: env.KAFKA_PATIENT_CHANGE_TOPIC || 'business.events',
                            bwellPersonFinder: c.bwellPersonFinder,
                            configManager: c.configManager,
                            requestSpecificCache: c.requestSpecificCache
                        })
                );
                return container1;
            });

            // noinspection JSCheckFunctionSignatures
            const onPatientCreateAsyncMock = jest
                .spyOn(MockChangeEventProducer.prototype, 'onPatientCreateAsync')
                .mockImplementation(() => {
                });
            // noinspection JSCheckFunctionSignatures
            const onPatientChangeAsyncMock = jest
                .spyOn(MockChangeEventProducer.prototype, 'onPatientChangeAsync')
                .mockImplementation(() => {
                });
            // noinspection JSCheckFunctionSignatures
            const onConsentCreateAsync = jest
                .spyOn(MockChangeEventProducer.prototype, 'onConsentCreateAsync')
                .mockImplementation(() => {
                });
            // noinspection JSCheckFunctionSignatures
            const onConsentChangeAsync = jest
                .spyOn(MockChangeEventProducer.prototype, 'onConsentChangeAsync')
                .mockImplementation(() => {
                });
            /**
             * @type {DatabaseBulkInserter}
             */
            const databaseBulkInserter = container.databaseBulkInserter;
            const requestId = '1234';

            await databaseBulkInserter.insertOneAsync({
                requestId: requestId,
                resourceType: 'Patient', doc: new Patient(patient)
            });
            await databaseBulkInserter.insertOneAsync({
                requestId: requestId,
                resourceType: 'Observation',
                doc: new Observation(observation),
            });
            await databaseBulkInserter.insertOneAsync({
                requestId: requestId,
                resourceType: 'Consent',
                doc: new Consent(consent)
            });

            patient.birthDate = '2020-01-01';
            await databaseBulkInserter.mergeOneAsync({
                requestId: requestId,
                resourceType: 'Patient',
                id: patient.id,
                doc: new Patient(patient),
                previousVersionId: '1',
                patches: null
            });

            // now execute the bulk inserts
            const base_version = '4_0_0';
            await databaseBulkInserter.executeAsync({
                requestId: requestId,
                currentDate,
                base_version,
                method: 'POST'
            });

            /**
             * @type {PostRequestProcessor}
             */
            const postRequestProcessor = container.postRequestProcessor;
            await postRequestProcessor.executeAsync({requestId});
            await postRequestProcessor.waitTillDoneAsync({requestId});

            /**
             * @type {MongoDatabaseManager}
             */
            const mongoDatabaseManager = container.mongoDatabaseManager;
            /**
             * mongo connection
             * @type {import('mongodb').Db}
             */
            const fhirDb = await mongoDatabaseManager.getClientDbAsync();
            // check patients
            const patientCollection = `Patient_${base_version}`;
            const patients = await fhirDb.collection(patientCollection).find().toArray();
            expect(patients.length).toStrictEqual(1);
            expect(patients[0].id).toStrictEqual('00100000000');
            // check observations
            const observationCollection = `Observation_${base_version}`;
            const observations = await fhirDb.collection(observationCollection).find().toArray();
            expect(observations.length).toStrictEqual(1);
            expect(observations[0].id).toStrictEqual('2354-InAgeCohort');

            expect(onPatientCreateAsyncMock).toBeCalledTimes(1);
            expect(onPatientChangeAsyncMock).toBeCalledTimes(2);
            expect(onConsentCreateAsync).toBeCalledTimes(1);
            expect(onConsentChangeAsync).toBeCalledTimes(0);
        });
        test('execAsync works for Person change events', async () => {
            /**
             * @type {string}
             */
            const currentDate = moment.utc().format('YYYY-MM-DD');

            const container = createTestContainer((container1) => {
                container1.register(
                    'changeEventProducer',
                    (c) =>
                        new MockChangeEventProducer({
                            kafkaClient: c.kafkaClient,
                            resourceManager: c.resourceManager,
                            patientChangeTopic: env.KAFKA_PATIENT_CHANGE_TOPIC || 'business.events',
                            consentChangeTopic: env.KAFKA_PATIENT_CHANGE_TOPIC || 'business.events',
                            bwellPersonFinder: c.bwellPersonFinder,
                            configManager: c.configManager,
                            requestSpecificCache: c.requestSpecificCache
                        })
                );
                return container1;
            });

            // noinspection JSCheckFunctionSignatures
            const onPatientCreateAsyncMock = jest
                .spyOn(MockChangeEventProducer.prototype, 'onPatientCreateAsync')
                .mockImplementation(() => {
                });
            // noinspection JSCheckFunctionSignatures
            const onPatientChangeAsyncMock = jest
                .spyOn(MockChangeEventProducer.prototype, 'onPatientChangeAsync')
                .mockImplementation(() => {
                });
            /**
             * @type {DatabaseBulkInserter}
             */
            const databaseBulkInserter = container.databaseBulkInserter;
            const requestId = '1234';

            await databaseBulkInserter.insertOneAsync({
                requestId: requestId,
                resourceType: 'Person', doc: new Person(bwellPerson)
            });
            await databaseBulkInserter.insertOneAsync({
                requestId: requestId,
                resourceType: 'Person', doc: new Person(clientPerson)
            });

            // now execute the bulk inserts
            const base_version = '4_0_0';
            await databaseBulkInserter.executeAsync({
                requestId: requestId,
                currentDate,
                base_version,
                method: 'POST'
            });

            /**
             * @type {PostRequestProcessor}
             */
            const postRequestProcessor = container.postRequestProcessor;
            await postRequestProcessor.executeAsync({requestId});
            await postRequestProcessor.waitTillDoneAsync({requestId});

            expect(onPatientCreateAsyncMock).toBeCalledTimes(1);
            expect(onPatientChangeAsyncMock).toBeCalledTimes(0);
        });
        test('execAsync handles mongo error', async () => {
            /**
             * @type {string}
             */
            const currentDate = moment.utc().format('YYYY-MM-DD');

            const container = createTestContainer((container1) => {
                container1.register(
                    'changeEventProducer',
                    (c) =>
                        new MockChangeEventProducer({
                            kafkaClient: c.kafkaClient,
                            resourceManager: c.resourceManager,
                            patientChangeTopic: env.KAFKA_PATIENT_CHANGE_TOPIC || 'business.events',
                            consentChangeTopic: env.KAFKA_PATIENT_CHANGE_TOPIC || 'business.events',
                            bwellPersonFinder: c.bwellPersonFinder,
                            configManager: c.configManager,
                            requestSpecificCache: c.requestSpecificCache
                        })
                );
                return container1;
            });

            // noinspection JSCheckFunctionSignatures
            const onPatientCreateAsyncMock = jest
                .spyOn(MockChangeEventProducer.prototype, 'onPatientCreateAsync')
                .mockImplementation(() => {
                });
            // noinspection JSCheckFunctionSignatures
            const onPatientChangeAsyncMock = jest
                .spyOn(MockChangeEventProducer.prototype, 'onPatientChangeAsync')
                .mockImplementation(() => {
                });
            // noinspection JSCheckFunctionSignatures
            const onConsentCreateAsync = jest
                .spyOn(MockChangeEventProducer.prototype, 'onConsentCreateAsync')
                .mockImplementation(() => {
                });
            // noinspection JSCheckFunctionSignatures
            const onConsentChangeAsync = jest
                .spyOn(MockChangeEventProducer.prototype, 'onConsentChangeAsync')
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
            const patientCollection = `Patient_${base_version}`;
            // noinspection JSCheckFunctionSignatures
            jest
                .spyOn(Collection.prototype, 'bulkWrite')
                .mockImplementation(() => {
                    const result = {
                        nMatched: 1, nUpserted: 1, hasWriteErrors: () => true,
                        getWriteErrors: () => [
                            {
                                code: 1, index: 1, errMsg: 'Error msg test',
                                toJSON: () => JSON.parse('{"code": 1, "index": 1, "errMsg": "Error msg test"}'),
                            },
                        ],
                    };
                    return result;
                });
            /**
             * @type {DatabaseBulkInserter}
             */
            const databaseBulkInserter = container.databaseBulkInserter;
            const requestId = '1234';

            await databaseBulkInserter.insertOneAsync({
                requestId: requestId,
                resourceType: 'Patient', doc: new Patient(patient)
            });
            await databaseBulkInserter.insertOneAsync({
                requestId: requestId,
                resourceType: 'Observation',
                doc: new Observation(observation),
            });
            await databaseBulkInserter.insertOneAsync({
                requestId: requestId,
                resourceType: 'Consent',
                doc: new Consent(consent)
            });

            patient.birthDate = '2020-01-01';
            await databaseBulkInserter.mergeOneAsync({
                requestId: requestId,
                resourceType: 'Patient',
                id: patient.id,
                doc: new Patient(patient),
                previousVersionId: '1',
                patches: null
            });

            // now execute the bulk inserts
            const result = await databaseBulkInserter.executeAsync({
                requestId: requestId,
                currentDate,
                base_version,
                method: 'POST'
            });

            /**
             * @type {PostRequestProcessor}
             */
            const postRequestProcessor = container.postRequestProcessor;
            await postRequestProcessor.executeAsync({requestId});
            await postRequestProcessor.waitTillDoneAsync({requestId});

            // Check the result has errors
            expect(result).not.toBeNull();
            expect(result.length).toBeGreaterThanOrEqual(2);

            // check patients
            const patients = await fhirDb.collection(patientCollection).find().toArray();
            expect(patients.length).toStrictEqual(0);
            // check observations
            const observationCollection = `Observation_${base_version}`;
            const observations = await fhirDb.collection(observationCollection).find().toArray();
            expect(observations.length).toStrictEqual(0);

            expect(onPatientCreateAsyncMock).toBeCalledTimes(1);
            expect(onPatientChangeAsyncMock).toBeCalledTimes(2);
            expect(onConsentCreateAsync).toBeCalledTimes(1);
            expect(onConsentChangeAsync).toBeCalledTimes(0);
        });
    });
    describe('databaseBulkInserter CodeSystem concurrency Tests', () => {
        test('execAsync works on CodeSystem without concurrency', async () => {
            /**
             * @type {string}
             */
            const currentDate = moment.utc().format('YYYY-MM-DD');

            const container = createTestContainer((container1) => {
                container1.register(
                    'changeEventProducer',
                    (c) =>
                        new MockChangeEventProducer({
                            kafkaClient: c.kafkaClient,
                            resourceManager: c.resourceManager,
                            patientChangeTopic: env.KAFKA_PATIENT_CHANGE_TOPIC || 'business.events',
                            consentChangeTopic: env.KAFKA_PATIENT_CHANGE_TOPIC || 'business.events',
                            bwellPersonFinder: c.bwellPersonFinder,
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
                            'code': 'client',
                            'system': 'https://www.icanbwell.com/owner'
                        }),
                        new Coding({
                            'code': 'client',
                            'system': 'https://www.icanbwell.com/sourceAssigningAuthority'
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
                {includeResultMetadata: true}
            );
            expect(updateResult.lastErrorObject).toStrictEqual({
                'n': 1,
                'updatedExisting': true
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
                            'code': 'client',
                            'system': 'https://www.icanbwell.com/owner'
                        }),
                        new Coding({
                            'code': 'client',
                            'system': 'https://www.icanbwell.com/sourceAssigningAuthority'
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
                            'system': 'https://www.icanbwell.com/owner',
                            'code': 'client'
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
                    ),
                ]
            });
            await databaseBulkInserter.mergeOneAsync({
                requestId: requestId,
                resourceType: 'CodeSystem',
                id: codeSystem2.id,
                doc: codeSystem2,
                previousVersionId: '1',
                patches: null
            });

            // now execute the bulk inserts
            const base_version = '4_0_0';
            /**
             * @type {MergeResultEntry[]}
             */
            const mergeResults = await databaseBulkInserter.executeAsync({
                requestId: requestId,
                userRequestId,
                currentDate,
                base_version,
                method: 'POST'
            });
            expect(mergeResults.map(m => m.toJSON())).toStrictEqual([
                {
                    'created': false,
                    'id': 'loinc-1',
                    'resourceType': 'CodeSystem',
                    'sourceAssigningAuthority': 'client',
                    'updated': true,
                    'uuid': '93289a07-f21f-514b-9224-532b574c16cd'
                }
            ]);
            /**
             * @type {PostRequestProcessor}
             */
            const postRequestProcessor = container.postRequestProcessor;
            await postRequestProcessor.executeAsync({requestId, userRequestId});
            await postRequestProcessor.waitTillDoneAsync({requestId});

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
                            'system': 'https://www.icanbwell.com/owner',
                            'code': 'client'
                        }),
                        new Coding({
                            'code': 'client',
                            'system': 'https://www.icanbwell.com/sourceAssigningAuthority'
                        })
                    ]
                }),
                identifier: [
                    new Identifier({
                        'id': 'sourceId',
                        'system': 'https://www.icanbwell.com/sourceId',
                        'value': 'loinc-1'
                    }),
                    new Identifier({
                        'id': 'uuid',
                        'system': 'https://www.icanbwell.com/uuid',
                        'value': 'b627381e-4838-46cf-b9b0-02ad7b179219'
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
                    ),
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
                    'id': generateUUIDv5('loinc-1|client'),
                    'request': new BundleRequest({
                        'id': userRequestId,
                        'method': 'POST',
                        'url': '/4_0_0/CodeSystem/loinc-1'
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
                                    'system': 'https://www.icanbwell.com/owner',
                                    'code': 'client'
                                }),
                                new Coding({
                                    'code': 'client',
                                    'system': 'https://www.icanbwell.com/sourceAssigningAuthority'
                                })
                            ]
                        }),
                        'identifier': [
                            new Identifier({
                                'id': 'sourceId',
                                'system': 'https://www.icanbwell.com/sourceId',
                                'value': 'loinc-1'
                            }),
                            new Identifier({
                                'id': 'uuid',
                                'system': 'https://www.icanbwell.com/uuid',
                                'value': 'e7f9d7f5-f443-4aa6-aaa8-90bbb676f252'
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
                            ),
                        ]
                    }),
                    response: new BundleResponse({
                        'outcome': new OperationOutcome({
                            'issue': [
                                new OperationOutcomeIssue(
                                    {
                                        'code': 'informational',
                                        'diagnostics': '{"op":"add","path":"/concept/2","value":{"id":"6665-3","code":"6665-3","property":[{"code":"medline_plus","valueString":"3"}]}}',
                                        'severity': 'information'
                                    }
                                ),
                                new OperationOutcomeIssue(
                                    {
                                        'code': 'informational',
                                        'diagnostics': '{"op":"add","path":"/identifier","value":[{"system":"https://www.icanbwell.com/sourceId","value":"loinc-1"},{"system":"https://www.icanbwell.com/uuid","value":"e7f9d7f5-f443-4aa6-aaa8-90bbb676f252"}]}',
                                        'severity': 'information'
                                    }
                                )
                            ],
                            'resourceType': 'OperationOutcome'
                        }),
                        'status': '200'
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
            /**
             * @type {string}
             */
            const currentDate = moment.utc().format('YYYY-MM-DD');

            const container = createTestContainer((container1) => {
                container1.register(
                    'changeEventProducer',
                    (c) =>
                        new MockChangeEventProducer({
                            kafkaClient: c.kafkaClient,
                            resourceManager: c.resourceManager,
                            patientChangeTopic: env.KAFKA_PATIENT_CHANGE_TOPIC || 'business.events',
                            consentChangeTopic: env.KAFKA_PATIENT_CHANGE_TOPIC || 'business.events',
                            bwellPersonFinder: c.bwellPersonFinder,
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
                                'system': 'https://www.icanbwell.com/owner',
                                'code': 'client'
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
                            'system': 'https://www.icanbwell.com/owner',
                            'code': 'client'
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
                    ),
                ]
            });
            await databaseBulkInserter.mergeOneAsync({
                requestId: requestId,
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
                            'system': 'https://www.icanbwell.com/owner',
                            'code': 'client'
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
                {id: 'loinc-1'},
                codeSystem1.toJSONInternal(),
                {includeResultMetadata: true}
            );
            expect(updateResult.lastErrorObject).toStrictEqual({
                'n': 1,
                'updatedExisting': true
            });
            const codeSystemsBeforeBulkUpdate = await fhirDb.collection(collectionName).find().toArray();
            expect(codeSystemsBeforeBulkUpdate.length).toStrictEqual(1);
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
                            'system': 'https://www.icanbwell.com/owner',
                            'code': 'client'
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
            const base_version = '4_0_0';
            /**
             * @type {MergeResultEntry[]}
             */
            const mergeResults = await databaseBulkInserter.executeAsync({
                requestId: requestId,
                currentDate,
                base_version,
                userRequestId,
                method: 'POST'
            });
            expect(mergeResults.map(m => m.toJSON())).toStrictEqual([
                {
                    'id': 'loinc-1',
                    'created': false,
                    'resourceType': 'CodeSystem',
                    'sourceAssigningAuthority': 'client',
                    'updated': true,
                    'uuid': '93289a07-f21f-514b-9224-532b574c16cd'
                }
            ]);
            /**
             * @type {PostRequestProcessor}
             */
            const postRequestProcessor = container.postRequestProcessor;
            await postRequestProcessor.executeAsync({requestId, userRequestId});
            await postRequestProcessor.waitTillDoneAsync({requestId});

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
                            'system': 'https://www.icanbwell.com/owner',
                            'code': 'client'
                        }),
                        new Coding({
                            'code': 'client',
                            'system': 'https://www.icanbwell.com/sourceAssigningAuthority'
                        })
                    ]
                }),
                'identifier': [
                    new Identifier({
                        'id': 'sourceId',
                        'system': 'https://www.icanbwell.com/sourceId',
                        'value': 'loinc-1'
                    }),
                    new Identifier({
                        'id': 'uuid',
                        'system': 'https://www.icanbwell.com/uuid',
                        'value': '30567620-6073-44c1-b77a-83cb11fc971e'
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
                    ),
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
                    'id': generateUUIDv5('loinc-1|client'),
                    'request': new BundleRequest({
                        'id': userRequestId,
                        'method': 'POST',
                        'url': '/4_0_0/CodeSystem/loinc-1'
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
                                    'system': 'https://www.icanbwell.com/owner',
                                    'code': 'client'
                                }),
                                new Coding({
                                    'code': 'client',
                                    'system': 'https://www.icanbwell.com/sourceAssigningAuthority'
                                })
                            ]
                        }),
                        'identifier': [
                            new Identifier({
                                'id': 'sourceId',
                                'system': 'https://www.icanbwell.com/sourceId',
                                'value': 'loinc-1'
                            }),
                            new Identifier({
                                'id': 'uuid',
                                'system': 'https://www.icanbwell.com/uuid',
                                'value': 'f67ac4cf-d135-46ac-b23d-a16289a61074'
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
                            ),
                        ]
                    }),
                    'response': new BundleResponse({
                        'outcome': new OperationOutcome({
                            'issue': [
                                new OperationOutcomeIssue(
                                    {
                                        'code': 'informational',
                                        'diagnostics': '{"op":"add","path":"/concept/2","value":{"id":"6665-3","code":"6665-3","property":[{"code":"medline_plus","valueString":"3"}]}}',
                                        'severity': 'information'
                                    }
                                ),
                                new OperationOutcomeIssue(
                                    {
                                        'code': 'informational',
                                        'diagnostics': '{"op":"add","path":"/identifier","value":[{"system":"https://www.icanbwell.com/sourceId","value":"loinc-1"},{"system":"https://www.icanbwell.com/uuid","value":"f67ac4cf-d135-46ac-b23d-a16289a61074"}]}',
                                        'severity': 'information'
                                    }
                                ),
                                new OperationOutcomeIssue(
                                    {
                                        'code': 'informational',
                                        'diagnostics': '{"op":"add","path":"/identifier","value":[{"id":"sourceId","system":"https://www.icanbwell.com/sourceId","value":"loinc-1"},{"id":"uuid","system":"https://www.icanbwell.com/uuid","value":"93289a07-f21f-514b-9224-532b574c16cd"}]}',
                                        'severity': 'information'
                                    }
                                )
                            ],
                            'resourceType': 'OperationOutcome'
                        }),
                        'status': '200'
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
            /**
             * @type {string}
             */
            const currentDate = moment.utc().format('YYYY-MM-DD');

            const container = createTestContainer((container1) => {
                container1.register(
                    'changeEventProducer',
                    (c) =>
                        new MockChangeEventProducer({
                            kafkaClient: c.kafkaClient,
                            resourceManager: c.resourceManager,
                            patientChangeTopic: env.KAFKA_PATIENT_CHANGE_TOPIC || 'business.events',
                            consentChangeTopic: env.KAFKA_PATIENT_CHANGE_TOPIC || 'business.events',
                            bwellPersonFinder: c.bwellPersonFinder,
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
                            'system': 'https://www.icanbwell.com/owner',
                            'code': 'client'
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
                            'system': 'https://www.icanbwell.com/owner',
                            'code': 'client'
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
                            'system': 'https://www.icanbwell.com/owner',
                            'code': 'client'
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
                    ),
                ]
            });
            await databaseBulkInserter.insertOneAsync({
                requestId: requestId,
                resourceType: 'CodeSystem',
                doc: codeSystemOriginal,
            });

            await databaseBulkInserter.insertOneAsync({
                requestId: requestId,
                resourceType: 'CodeSystem',
                doc: codeSystem1,
            });

            await databaseBulkInserter.mergeOneAsync({
                requestId: requestId,
                resourceType: 'CodeSystem',
                doc: codeSystem2,
                previousVersionId: null,
                patches: null
            });

            // now execute the bulk inserts
            const base_version = '4_0_0';
            /**
             * @type {MergeResultEntry[]}
             */
            const mergeResults = await databaseBulkInserter.executeAsync({
                requestId: requestId,
                currentDate,
                base_version,
                method: 'POST'
            });
            expect(mergeResults.map(m => m.toJSON())).toStrictEqual([
                {
                    'created': true,
                    'id': 'loinc-1',
                    'resourceType': 'CodeSystem',
                    'sourceAssigningAuthority': 'client',
                    'updated': false,
                    'uuid': '93289a07-f21f-514b-9224-532b574c16cd'
                }
            ]);
            /**
             * @type {PostRequestProcessor}
             */
            const postRequestProcessor = container.postRequestProcessor;
            await postRequestProcessor.executeAsync({requestId});
            await postRequestProcessor.waitTillDoneAsync({requestId});

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
                            'system': 'https://www.icanbwell.com/owner',
                            'code': 'client'
                        }),
                        new Coding({
                            'code': 'client',
                            'system': 'https://www.icanbwell.com/sourceAssigningAuthority'
                        })
                    ]
                }),
                'identifier': [
                    new Identifier({
                        'id': 'sourceId',
                        'system': 'https://www.icanbwell.com/sourceId',
                        'value': 'loinc-1'
                    }),
                    new Identifier({
                        'id': 'uuid',
                        'system': 'https://www.icanbwell.com/uuid',
                        'value': '946e32d8-2645-4d3c-8fac-5fd96ee3a29c'
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
                    ),
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
            /**
             * @type {string}
             */
            const currentDate = moment.utc().format('YYYY-MM-DD');

            const container = createTestContainer((container1) => {
                container1.register(
                    'changeEventProducer',
                    (c) =>
                        new MockChangeEventProducer({
                            kafkaClient: c.kafkaClient,
                            resourceManager: c.resourceManager,
                            patientChangeTopic: env.KAFKA_PATIENT_CHANGE_TOPIC || 'business.events',
                            consentChangeTopic: env.KAFKA_PATIENT_CHANGE_TOPIC || 'business.events',
                            bwellPersonFinder: c.bwellPersonFinder,
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
                            'system': 'https://www.icanbwell.com/owner',
                            'code': 'client'
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
                requestId: requestId,
                resourceType: 'CodeSystem',
                doc: codeSystemOriginal,
            });

            await databaseBulkInserter.insertOneAsync({
                requestId: requestId,
                resourceType: 'CodeSystem',
                doc: codeSystemOriginal,
            });

            await databaseBulkInserter.mergeOneAsync({
                requestId: requestId,
                id: codeSystemOriginal.id,
                resourceType: 'CodeSystem',
                doc: codeSystemOriginal,
                previousVersionId: null,
                patches: null
            });

            // now execute the bulk inserts
            const base_version = '4_0_0';
            /**
             * @type {MergeResultEntry[]}
             */
            const mergeResults = await databaseBulkInserter.executeAsync({
                requestId: requestId,
                currentDate,
                base_version,
                method: 'POST'
            });
            expect(mergeResults.map(m => m.toJSON())).toStrictEqual([
                {
                    'created': true,
                    'id': 'loinc-1',
                    'resourceType': 'CodeSystem',
                    'sourceAssigningAuthority': 'client',
                    'updated': false,
                    'uuid': '93289a07-f21f-514b-9224-532b574c16cd'
                }
            ]);
            /**
             * @type {PostRequestProcessor}
             */
            const postRequestProcessor = container.postRequestProcessor;
            await postRequestProcessor.executeAsync({requestId});
            await postRequestProcessor.waitTillDoneAsync({requestId});

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
                'concept': [
                    new CodeSystemConcept({
                        'code': '3565-4',
                        'id': '3565-4',
                        'property': [
                            new CodeSystemProperty1({
                                'code': 'medline_plus',
                                'valueString': '1'
                            })
                        ]
                    })
                ],
                'content': 'complete',
                'id': 'loinc-1',
                'meta': new Meta({
                    'versionId': '1',
                    source: 'http://www/icanbwell.com',
                    security: [
                        new Coding(
                            {
                                'system': 'https://www.icanbwell.com/owner',
                                'code': 'client'
                            }
                        ),
                        new Coding(
                            {
                                'code': 'client',
                                'system': 'https://www.icanbwell.com/sourceAssigningAuthority'
                            }
                        )
                    ]
                }),
                identifier: [
                    new Identifier({
                        'id': 'sourceId',
                        'system': 'https://www.icanbwell.com/sourceId',
                        'value': 'loinc-1'
                    }),
                    new Identifier({
                        'id': 'uuid',
                        'system': 'https://www.icanbwell.com/uuid',
                        'value': 'd05fce76-7645-41f0-968a-9b42dd579a6d'
                    })
                ],
                'resourceType': 'CodeSystem',
                'status': 'active'
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
