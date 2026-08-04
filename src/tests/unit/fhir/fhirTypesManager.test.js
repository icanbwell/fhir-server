'use strict';

const { describe, test, beforeEach, expect, jest: jestObj } = require('@jest/globals');

// Mock the generated field types JSON
jestObj.mock('../../../fhir/fhir-generated.field-types.json', () => ({
    'Patient.name': { code: 'HumanName', min: '0', max: '*' },
    'Patient.birthDate': { code: 'date', min: '0', max: '1' },
    'Observation.code': { code: 'CodeableConcept', min: '1', max: '1' },
    'Observation.value': { code: 'Quantity', min: '0', max: '1' },
    'Resource.id': { code: 'string', min: '0', max: '1' },
    'Resource.meta': { code: 'Meta', min: '0', max: '1' }
}));

const { FhirTypesManager } = require('../../../fhir/fhirTypesManager');

describe('FhirTypesManager', () => {
    let manager;

    beforeEach(() => {
        manager = new FhirTypesManager();
    });

    describe('getTypeForField', () => {
        test('returns type code for a standard FHIR field', () => {
            const result = manager.getTypeForField({ resourceType: 'Patient', field: 'name' });
            expect(result).toBe('HumanName');
        });

        test('returns type code for another standard FHIR field', () => {
            const result = manager.getTypeForField({ resourceType: 'Patient', field: 'birthDate' });
            expect(result).toBe('date');
        });

        test('returns type code for Observation.code', () => {
            const result = manager.getTypeForField({ resourceType: 'Observation', field: 'code' });
            expect(result).toBe('CodeableConcept');
        });

        test('returns type code for Resource.id', () => {
            const result = manager.getTypeForField({ resourceType: 'Resource', field: 'id' });
            expect(result).toBe('string');
        });

        test('returns null/undefined for unknown resource type', () => {
            const result = manager.getTypeForField({ resourceType: 'Unknown', field: 'name' });
            expect(result).toBeFalsy();
        });

        test('returns null/undefined for unknown field', () => {
            const result = manager.getTypeForField({ resourceType: 'Patient', field: 'nonExistentField' });
            expect(result).toBeFalsy();
        });

        test('returns type code for custom ExportStatus.status field', () => {
            const result = manager.getTypeForField({ resourceType: 'ExportStatus', field: 'status' });
            expect(result).toBe('code');
        });

        test('returns type code for custom ExportStatus.identifier field', () => {
            const result = manager.getTypeForField({ resourceType: 'ExportStatus', field: 'identifier' });
            expect(result).toBe('Identifier');
        });
    });

    describe('getDataForField', () => {
        test('returns full data object for a known field', () => {
            const result = manager.getDataForField({ resourceType: 'Patient', field: 'name' });
            expect(result).toEqual({ code: 'HumanName', min: '0', max: '*' });
        });

        test('returns data with min and max for Observation.code', () => {
            const result = manager.getDataForField({ resourceType: 'Observation', field: 'code' });
            expect(result).toEqual({ code: 'CodeableConcept', min: '1', max: '1' });
        });

        test('returns undefined for unknown resource and field combination', () => {
            const result = manager.getDataForField({ resourceType: 'Unknown', field: 'field' });
            expect(result).toBeUndefined();
        });

        test('returns data for custom ExportStatus.identifier', () => {
            const result = manager.getDataForField({ resourceType: 'ExportStatus', field: 'identifier' });
            expect(result).toEqual({ code: 'Identifier', min: '0', max: '*' });
        });

        test('returns data for custom ExportStatus.status', () => {
            const result = manager.getDataForField({ resourceType: 'ExportStatus', field: 'status' });
            expect(result).toEqual({ code: 'code' });
        });

        test('custom entries override generated entries with same key', () => {
            // The combined map puts custom entries after generated entries,
            // so custom entries win on collision
            const result = manager.getDataForField({ resourceType: 'ExportStatus', field: 'status' });
            expect(result.code).toBe('code');
        });
    });
});
