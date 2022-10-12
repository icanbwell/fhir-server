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

            expect(fhirTypesManager.getTypeForField({resourceType: 'Task', field: 'status'})).toStrictEqual('code');
            expect(fhirTypesManager.getTypeForField({
                resourceType: 'Observation',
                field: 'code'
            })).toStrictEqual('CodeableConcept');
            expect(fhirTypesManager.getTypeForField({
                resourceType: 'Observation',
                field: 'identifier'
            })).toStrictEqual('Identifier');
            expect(fhirTypesManager.getTypeForField({
                resourceType: 'Appointment',
                field: 'description'
            })).toStrictEqual('string');
            expect(fhirTypesManager.getTypeForField({
                resourceType: 'Appointment',
                field: 'specialty'
            })).toStrictEqual('CodeableConcept');
            expect(fhirTypesManager.getTypeForField({
                resourceType: 'AuditEvent',
                field: 'type'
            })).toStrictEqual('Coding');
            expect(fhirTypesManager.getTypeForField({
                resourceType: 'AuditEvent',
                field: 'subtype'
            })).toStrictEqual('Coding');
            expect(fhirTypesManager.getTypeForField({
                resourceType: 'AuditEvent',
                field: 'agent.role'
            })).toStrictEqual('CodeableConcept');
            expect(fhirTypesManager.getTypeForField({
                resourceType: 'Measure',
                field: 'library'
            })).toStrictEqual('Reference');
            expect(fhirTypesManager.getTypeForField({
                resourceType: 'Measure',
                field: 'approvalDate'
            })).toStrictEqual('date');
        });
    });
});
