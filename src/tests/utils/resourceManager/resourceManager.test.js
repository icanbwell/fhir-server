const patient = require('./fixtures/patient.json');
const observation = require('./fixtures/observation.json');
const { describe, expect, test } = require('@jest/globals');
const { ResourceManager } = require('../../../operations/common/resourceManager');

describe('resourceManager Tests', () => {
    describe('resourceManager Tests', () => {
        test('getPatientIdFromResourceAsync works for Patient', async () => {
            const resourceManager = new ResourceManager();
            const patientFieldName = resourceManager.getPatientFieldNameFromResource('Patient');
            expect(patientFieldName).toStrictEqual('id');

            const patientId = await resourceManager.getPatientIdFromResourceAsync(
                'Patient',
                patient
            );
            expect(patientId).toStrictEqual('00100000000');
        });
        test('getPatientIdFromResourceAsync works for Observation', async () => {
            const resourceManager = new ResourceManager();
            const patientFieldName = resourceManager.getPatientFieldNameFromResource('Observation');
            expect(patientFieldName).toStrictEqual('subject');

            const patientId = await resourceManager.getPatientIdFromResourceAsync(
                'Observation',
                observation
            );
            expect(patientId).toStrictEqual('2354');
        });
    });
});
