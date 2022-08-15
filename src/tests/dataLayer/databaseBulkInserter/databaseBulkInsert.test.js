const patient = require('./fixtures/patient.json');
const observation = require('./fixtures/observation.json');
const {describe, expect, beforeEach, afterEach} = require('@jest/globals');
const {DatabaseBulkInserter} = require('../../../dataLayer/databaseBulkInserter');
const moment = require('moment-timezone');
const {commonBeforeEach, commonAfterEach} = require('../../common');
const globals = require('../../../globals');
const {CLIENT_DB} = require('../../../constants');

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

            const databaseBulkInserter = new DatabaseBulkInserter('1234', currentDate);

            await databaseBulkInserter.insertOneAsync('Patient', patient);
            await databaseBulkInserter.insertOneAsync('Observation', observation);

            patient.birthDate = '2020-01-01';
            await databaseBulkInserter.replaceOneAsync('Patient', patient.id, patient);

            const patientCreateHandler = jest.fn();
            const patientChangeHandler = jest.fn();

            databaseBulkInserter.on('createPatient', patientCreateHandler);
            databaseBulkInserter.on('changePatient', patientChangeHandler);

            // now execute the bulk inserts
            const base_version = '4_0_0';
            await databaseBulkInserter.executeAsync(base_version, false);

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

            expect(patientCreateHandler).toBeCalledTimes(1);
            expect(patientChangeHandler).toBeCalledTimes(2);
        });
    });
});
