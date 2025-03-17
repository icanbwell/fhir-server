const deepcopy = require('deepcopy');
const expectedPatient = require('./fixtures/expected/expected.json');
const patientBundle = require('./fixtures/resources/patient.json');
const combinedBundle = require('./fixtures/resources/patientCombinedBundle.json');
const expectedCombinedBundle = require('./fixtures/expected/expectedCombinedBundle.json');

const { FhirResourceSerializer } = require('../../../fhir/fhirResourceSerializer.js')
const { commonBeforeEach, commonAfterEach, createTestRequest } = require('../../common.js');
const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');

describe('Patient Serialzier Tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('Bundle Serializer Tests', () => {
        test('serializer should remove all extra fields from patient resource', async () => {
            await createTestRequest();
            const serializedData = FhirResourceSerializer.serialize(deepcopy(patientBundle))
            expect(serializedData).toStrictEqual(expectedPatient)
        });

        test('serializer should handle if passed data is null', async () => {
            await createTestRequest();
            const serializedData = FhirResourceSerializer.serialize(null)
            expect(serializedData).toBeNull()
        });

        test('should handle bundle containing composition and patient', async () => {
            await createTestRequest();
            const serializeData = FhirResourceSerializer.serialize(deepcopy(combinedBundle));
            expect(serializeData).toStrictEqual(expectedCombinedBundle);
        })
    });
});
