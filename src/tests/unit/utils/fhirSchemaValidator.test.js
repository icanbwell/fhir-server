'use strict';

const { describe, test, expect } = require('@jest/globals');
const { FhirSchemaValidator } = require('../../../utils/fhirSchemaValidator');

describe('FhirSchemaValidator', () => {
    const testSchema = {
        $schema: 'http://json-schema.org/draft-06/schema#',
        oneOf: [
            { $ref: '#/definitions/Patient' },
            { $ref: '#/definitions/Observation' }
        ],
        definitions: {
            Patient: {
                type: 'object',
                properties: {
                    resourceType: { type: 'string', enum: ['Patient'] },
                    id: { type: 'string' },
                    active: { type: 'boolean' }
                },
                required: ['resourceType']
            },
            Observation: {
                type: 'object',
                properties: {
                    resourceType: { type: 'string', enum: ['Observation'] },
                    id: { type: 'string' },
                    status: { type: 'string' }
                },
                required: ['resourceType']
            }
        }
    };

    let validator;

    test('constructor initializes with schema', () => {
        validator = new FhirSchemaValidator(testSchema);
        expect(validator.schema).toBe(testSchema);
        expect(validator.validatorsByResourceType).toBeInstanceOf(Map);
    });

    test('validate returns empty array for valid resource', () => {
        validator = new FhirSchemaValidator(testSchema);
        const errors = validator.validate({ resourceType: 'Patient', id: '123', active: true });
        expect(errors).toEqual([]);
    });

    test('validate returns errors for invalid resource', () => {
        validator = new FhirSchemaValidator(testSchema);
        const errors = validator.validate({ resourceType: 'Patient', active: 'not-boolean' });
        expect(errors.length).toBeGreaterThan(0);
    });

    test('validate returns error for unknown resourceType', () => {
        validator = new FhirSchemaValidator(testSchema);
        const errors = validator.validate({ resourceType: 'Unknown' });
        expect(errors).toHaveLength(1);
        expect(errors[0].message).toContain("Invalid resourceType 'Unknown'");
    });

    test('validate returns error for null resource', () => {
        validator = new FhirSchemaValidator(testSchema);
        const errors = validator.validate(null);
        expect(errors).toHaveLength(1);
        expect(errors[0].message).toContain('Invalid resourceType');
    });

    test('getValidatorForResourceType returns null for unknown type', () => {
        validator = new FhirSchemaValidator(testSchema);
        const fn = validator.getValidatorForResourceType('NonExistent');
        expect(fn).toBeNull();
    });

    test('getValidatorForResourceType caches validator', () => {
        validator = new FhirSchemaValidator(testSchema);
        const fn1 = validator.getValidatorForResourceType('Patient');
        const fn2 = validator.getValidatorForResourceType('Patient');
        expect(fn1).toBe(fn2);
    });

    test('getAllResourceTypes returns array of type names', () => {
        validator = new FhirSchemaValidator(testSchema);
        const types = validator.getAllResourceTypes();
        expect(types).toContain('Patient');
        expect(types).toContain('Observation');
        expect(types).toHaveLength(2);
    });

    test('preWarm compiles all validators', () => {
        validator = new FhirSchemaValidator(testSchema);
        const count = validator.preWarm();
        expect(count).toBe(2);
        expect(validator.validatorsByResourceType.size).toBe(2);
    });
});
