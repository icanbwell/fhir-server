const patient = require('./fixtures/patient.json');
const observation = require('./fixtures/observation.json');
const {describe, expect} = require('@jest/globals');
const {ResourceManager} = require('../../../operations/common/resourceManager');

describe('resourceManager Tests', () => {
    describe('resourceManager Tests', () => {
        test('getPatientIdFromResourceAsync works for Patient', async () => {
            const patientFieldName = ResourceManager.getPatientFieldNameFromResource('Patient');
            expect(patientFieldName).toStrictEqual('id');

            const patientId = await ResourceManager.getPatientIdFromResourceAsync('Patient', patient);
            expect(patientId).toStrictEqual('00100000000');
        });
        test('getPatientIdFromResourceAsync works for Observation', async () => {
            const patientFieldName = ResourceManager.getPatientFieldNameFromResource('Observation');
            expect(patientFieldName).toStrictEqual('subject');

            const patientId = await ResourceManager.getPatientIdFromResourceAsync('Observation', observation);
            expect(patientId).toStrictEqual('2354');
        });
    });
});
