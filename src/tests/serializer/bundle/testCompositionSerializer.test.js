const expectedPatient = require('./fixtures/expected/expectedComposition.json');
const patientBundle = require('./fixtures/resources/composition.json');

const { FhirResourceSerializer } = require('../../../fhir/fhirResourceSerializer.js')
const { commonBeforeEach, commonAfterEach, createTestRequest } = require('../../common.js');
const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');

describe('Compositiion Serialzier Tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });


    test('serializer should remove all extra fields from composition resource', async () => {
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
