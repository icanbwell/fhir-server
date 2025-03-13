// test file
// const patient1Resource = require('./fixtures/Patient/patient1.json');

// expected
// const expectedPatientResources = require('./fixtures/expected/expected_patient.json');
const expectedPatient = require('./fixtures/expected/expected.json');
const patientBundle = require('./fixtures/resources/patient.json');

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
            const serializedData = FhirResourceSerializer.serialize(patientBundle)
            expect(serializedData).toMatchObject(expectedPatient)
        });

        test('serializer should handle if passed data is null', async () => {
            await createTestRequest();
            const serializedData = FhirResourceSerializer.serialize(null)
            expect(serializedData).toBeNull()
        });
    });
});
