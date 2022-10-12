const {commonBeforeEach, commonAfterEach} = require('../../common');
const {describe, beforeEach, afterEach, test} = require('@jest/globals');
const {FhirTypesManager} = require('../../../fhir/fhirTypesManager');

describe('FhirTypesManager Tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('FhirTypesManager Tests', () => {
        // noinspection JSUnresolvedFunction
        test('FhirTypesManager works', async () => {
            const fhirTypesManager = new FhirTypesManager();

            expect(fhirTypesManager.getTypeForField('Task', 'status')).toStrictEqual('code');
            expect(fhirTypesManager.getTypeForField('Observation', 'code')).toStrictEqual('CodeableConcept');
            expect(fhirTypesManager.getTypeForField('Observation', 'identifier')).toStrictEqual('Identifier');
            expect(fhirTypesManager.getTypeForField('Appointment', 'description')).toStrictEqual('string');
            expect(fhirTypesManager.getTypeForField('Appointment', 'specialty')).toStrictEqual('CodeableConcept');
            expect(fhirTypesManager.getTypeForField('AuditEvent', 'type')).toStrictEqual('Coding');
            expect(fhirTypesManager.getTypeForField('AuditEvent', 'subtype')).toStrictEqual('Coding');
        });
    });
});
