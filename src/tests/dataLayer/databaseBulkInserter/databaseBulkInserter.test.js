const patient = require('./fixtures/patient.json');
const observation = require('./fixtures/observation.json');
const {describe, expect, beforeEach, afterEach} = require('@jest/globals');
const moment = require('moment-timezone');
const {commonBeforeEach, commonAfterEach} = require('../../common');
const globals = require('../../../globals');
const {CLIENT_DB} = require('../../../constants');
const {createTestContainer} = require('../../createTestContainer');
const {ChangeEventProducer} = require('../../../utils/changeEventProducer');
const env = require('var');

class MockChangeEventProducer extends ChangeEventProducer {
    /**
     * Constructor
     * @param {KafkaClient} kafkaClient
     * @param {ResourceManager} resourceManager
     * @param {string} patientChangeTopic
     * @param {string} taskChangeTopic
     * @param {string} observationChangeTopic
     */
    constructor({
                    kafkaClient,
                    resourceManager,
                    patientChangeTopic,
                    taskChangeTopic,
                    observationChangeTopic
                }
    ) {
        super({
            kafkaClient, resourceManager, patientChangeTopic,
            taskChangeTopic, observationChangeTopic
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

            const container = createTestContainer(
                container1 => {
                    container1.register('changeEventProducer',
                        c => new MockChangeEventProducer({
                            kafkaClient: c.kafkaClient,
                            resourceManager: c.resourceManager,
                            patientChangeTopic: env.KAFKA_PATIENT_CHANGE_TOPIC || 'business.events',
                            taskChangeTopic: env.KAFKA_PATIENT_CHANGE_TOPIC || 'business.events',
                            observationChangeTopic: env.KAFKA_PATIENT_CHANGE_TOPIC || 'business.events',
                        }));
                    return container1;
                });

            const onPatientCreateAsyncMock = jest
                .spyOn(MockChangeEventProducer.prototype, 'onPatientCreateAsync')
                .mockImplementation(() => {
                });
            const onPatientChangeAsyncMock = jest
                .spyOn(MockChangeEventProducer.prototype, 'onPatientChangeAsync')
                .mockImplementation(() => {
                });
            const onObservationCreateAsync = jest
                .spyOn(MockChangeEventProducer.prototype, 'onObservationCreateAsync')
                .mockImplementation(() => {
                });
            const onObservationChangeAsync = jest
                .spyOn(MockChangeEventProducer.prototype, 'onObservationChangeAsync')
                .mockImplementation(() => {
                });
            /**
             * @type {DatabaseBulkInserter}
             */
            const databaseBulkInserter = container.databaseBulkInserter;

            await databaseBulkInserter.insertOneAsync({resourceType: 'Patient', doc: patient});
            await databaseBulkInserter.insertOneAsync({resourceType: 'Observation', doc: observation});

            patient.birthDate = '2020-01-01';
            await databaseBulkInserter.replaceOneAsync(
                {resourceType: 'Patient', id: patient.id, doc: patient});

            // now execute the bulk inserts
            const base_version = '4_0_0';
            const requestId1 = '1234';
            await databaseBulkInserter.executeAsync(
                {
                    requestId: requestId1, currentDate, base_version, useAtlas: false
                }
            );

            // noinspection JSValidateTypes
            /**
             * mongo connection
             * @type {import('mongodb').Db}
             */
            const fhirDb = globals.get(CLIENT_DB);
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
    });
});
