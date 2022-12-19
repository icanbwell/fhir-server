const patient = require('./fixtures/patient.json');
const observation = require('./fixtures/observation.json');
const {describe, expect, beforeEach, afterEach, test} = require('@jest/globals');
const moment = require('moment-timezone');
const {commonBeforeEach, commonAfterEach} = require('../../common');
const {createTestContainer} = require('../../createTestContainer');
const {ChangeEventProducer} = require('../../../utils/changeEventProducer');
const env = require('var');
const Patient = require('../../../fhir/classes/4_0_0/resources/patient');
const Observation = require('../../../fhir/classes/4_0_0/resources/observation');
const CodeSystem = require('../../../fhir/classes/4_0_0/resources/codeSystem');
const Meta = require('../../../fhir/classes/4_0_0/complex_types/meta');
const CodeSystemConcept = require('../../../fhir/classes/4_0_0/backbone_elements/codeSystemConcept');
const CodeSystemProperty1 = require('../../../fhir/classes/4_0_0/backbone_elements/codeSystemProperty1');

class MockChangeEventProducer extends ChangeEventProducer {
    /**
     * Constructor
     * @param {KafkaClientFactory} kafkaClientFactory
     * @param {ResourceManager} resourceManager
     * @param {string} patientChangeTopic
     * @param {string} taskChangeTopic
     * @param {string} observationChangeTopic
     * @param {BwellPersonFinder} bwellPersonFinder
     * @param {RequestSpecificCache} requestSpecificCache
     */
    constructor({
                    kafkaClientFactory,
                    resourceManager,
                    patientChangeTopic,
                    taskChangeTopic,
                    observationChangeTopic,
                    bwellPersonFinder,
                    requestSpecificCache
                }) {
        super({
            kafkaClientFactory,
            resourceManager,
            patientChangeTopic,
            taskChangeTopic,
            observationChangeTopic,
            bwellPersonFinder,
            requestSpecificCache
        });
    }
}

describe('databaseBulkInserter Tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
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
                            kafkaClientFactory: c.kafkaClientFactory,
                            resourceManager: c.resourceManager,
                            patientChangeTopic: env.KAFKA_PATIENT_CHANGE_TOPIC || 'business.events',
                            taskChangeTopic: env.KAFKA_PATIENT_CHANGE_TOPIC || 'business.events',
                            observationChangeTopic:
                                env.KAFKA_PATIENT_CHANGE_TOPIC || 'business.events',
                            bwellPersonFinder: c.bwellPersonFinder,
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
            const onObservationCreateAsync = jest
                .spyOn(MockChangeEventProducer.prototype, 'onObservationCreateAsync')
                .mockImplementation(() => {
                });
            // noinspection JSCheckFunctionSignatures
            const onObservationChangeAsync = jest
                .spyOn(MockChangeEventProducer.prototype, 'onObservationChangeAsync')
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

            patient.birthDate = '2020-01-01';
            await databaseBulkInserter.replaceOneAsync({
                requestId: requestId,
                resourceType: 'Patient',
                id: patient.id,
                doc: new Patient(patient),
            });

            // now execute the bulk inserts
            const base_version = '4_0_0';
            await databaseBulkInserter.executeAsync({
                requestId: requestId,
                currentDate,
                base_version
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
            expect(onObservationCreateAsync).toBeCalledTimes(1);
            expect(onObservationChangeAsync).toBeCalledTimes(0);
        });
        test('execAsync works with concurrency', async () => {
            /**
             * @type {string}
             */
            const currentDate = moment.utc().format('YYYY-MM-DD');

            const container = createTestContainer((container1) => {
                container1.register(
                    'changeEventProducer',
                    (c) =>
                        new MockChangeEventProducer({
                            kafkaClientFactory: c.kafkaClientFactory,
                            resourceManager: c.resourceManager,
                            patientChangeTopic: env.KAFKA_PATIENT_CHANGE_TOPIC || 'business.events',
                            taskChangeTopic: env.KAFKA_PATIENT_CHANGE_TOPIC || 'business.events',
                            observationChangeTopic:
                                env.KAFKA_PATIENT_CHANGE_TOPIC || 'business.events',
                            bwellPersonFinder: c.bwellPersonFinder,
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

            const codeSystem1 = new CodeSystem({
                id: 'loinc-1',
                status: 'active',
                content: 'complete',
                meta: new Meta({
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

            await codeSystemCollection.insertOne(codeSystem1.toJSONInternal());

            const codeSystem2 = new CodeSystem({
                id: 'loinc-1',
                status: 'active',
                content: 'complete',
                meta: new Meta({
                    versionId: '1'
                }),
                concept: [
                    new CodeSystemConcept(
                        {
                            id: '6665-3',
                            code: '6665-3',
                            property: [
                                new CodeSystemProperty1({
                                    code: 'medline_plus',
                                    valueString: '2'
                                })
                            ]
                        }
                    ),
                ]
            });
            await databaseBulkInserter.replaceOneAsync({
                requestId: requestId,
                resourceType: 'CodeSystem',
                id: codeSystem2.id,
                doc: codeSystem2,
            });

            // now execute the bulk inserts
            const base_version = '4_0_0';
            /**
             * @type {MergeResultEntry[]}
             */
            const mergeResults = await databaseBulkInserter.executeAsync({
                requestId: requestId,
                currentDate,
                base_version
            });
            expect(mergeResults).toStrictEqual([
                {
                    'id': 'loinc-1',
                    'created': false,
                    'updated': true,
                    'resourceType': 'CodeSystem'
                }
            ]);
            /**
             * @type {PostRequestProcessor}
             */
            const postRequestProcessor = container.postRequestProcessor;
            await postRequestProcessor.executeAsync({requestId});
            await postRequestProcessor.waitTillDoneAsync({requestId});

            // check patients
            const codeSystems = await fhirDb.collection(collectionName).find().toArray();
            expect(codeSystems.length).toStrictEqual(1);
            const expectedCodeSystem = new CodeSystem({
                id: 'loinc-1',
                status: 'active',
                content: 'complete',
                meta: new Meta({
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
                    ),
                    new CodeSystemConcept(
                        {
                            id: '6665-3',
                            code: '6665-3',
                            property: [
                                new CodeSystemProperty1({
                                    code: 'medline_plus',
                                    valueString: '2'
                                })
                            ]
                        }
                    ),
                ]
            });
            // noinspection JSCheckFunctionSignatures
            const actualCodeSystem = new CodeSystem(codeSystems[0]);
            expect(actualCodeSystem.toJSON()).toStrictEqual(expectedCodeSystem.toJSON());
        });
    });
});
