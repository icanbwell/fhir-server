'use strict';

const { describe, test, expect, beforeEach, jest } = require('@jest/globals');

/**
 * Unit tests for validateResource in validator.util.js
 *
 * Because customMatchers.js (loaded via setupFilesAfterEnv) pre-requires
 * validator.util.js and its dependencies, we must use jest.resetModules()
 * in beforeEach to ensure our mocks are used by the freshly-loaded module.
 */

let validateResource;
let fhirSchemaValidator;
let validateReferences;
let fastValidateReferences;
let Resource;

beforeEach(() => {
    jest.resetModules();

    jest.mock('../../../utils/fhirSchemaValidator', () => ({
        fhirSchemaValidator: {
            validate: jest.fn()
        }
    }));

    jest.mock('../../../utils/referenceValidator', () => ({
        validateReferences: jest.fn(),
        fastValidateReferences: jest.fn()
    }));

    jest.mock('../../../fhir/classes/4_0_0/resources/resource', () => {
        class MockResource {}
        return MockResource;
    });

    jest.mock('../../../fhir/classes/4_0_0/resources/operationOutcome', () => {
        return class OperationOutcome {
            constructor ({ issue }) {
                this.issue = issue;
                this.resourceType = 'OperationOutcome';
            }
        };
    });

    jest.mock('../../../fhir/classes/4_0_0/backbone_elements/operationOutcomeIssue', () => {
        return class OperationOutcomeIssue {
            constructor ({ severity, code, details }) {
                this.severity = severity;
                this.code = code;
                this.details = details;
            }
        };
    });

    jest.mock('../../../fhir/classes/4_0_0/complex_types/codeableConcept', () => {
        return class CodeableConcept {
            constructor ({ text }) {
                this.text = text;
            }
        };
    });

    ({ fhirSchemaValidator } = require('../../../utils/fhirSchemaValidator'));
    ({ validateReferences, fastValidateReferences } = require('../../../utils/referenceValidator'));
    Resource = require('../../../fhir/classes/4_0_0/resources/resource');
    ({ validateResource } = require('../../../utils/validator.util'));

    // Default: no errors
    fhirSchemaValidator.validate.mockReturnValue(null);
    validateReferences.mockReturnValue(null);
    fastValidateReferences.mockReturnValue(null);
});

describe('validateResource', () => {
    // ==========================================
    // 1. resourceType mismatch checks
    // ==========================================
    describe('resourceType mismatch', () => {
        test('returns OperationOutcome when resourceType does not match resourceName', () => {
            const result = validateResource({
                resourceBody: { resourceType: 'Observation' },
                resourceName: 'Patient',
                path: '/Patient'
            });

            expect(result).not.toBeNull();
            expect(result.resourceType).toBe('OperationOutcome');
            expect(result.issue).toHaveLength(1);
            expect(result.issue[0].severity).toBe('error');
            expect(result.issue[0].code).toBe('invalid');
            expect(result.issue[0].details.text).toContain('ResourceType does not match the endpoint');
        });

        test('includes the path and resourceType in the error message', () => {
            const result = validateResource({
                resourceBody: { resourceType: 'Observation' },
                resourceName: 'Patient',
                path: '/4_0_0/Patient/123'
            });

            expect(result.issue[0].details.text).toContain('/4_0_0/Patient/123');
            expect(result.issue[0].details.text).toContain('Observation');
        });

        test('case-sensitive mismatch: lowercase resourceType triggers error', () => {
            const result = validateResource({
                resourceBody: { resourceType: 'patient' },
                resourceName: 'Patient',
                path: '/Patient'
            });

            expect(result).not.toBeNull();
            expect(result.resourceType).toBe('OperationOutcome');
            expect(result.issue[0].details.text).toContain('ResourceType does not match the endpoint');
        });

        test('case-sensitive mismatch: uppercase resourceName triggers error', () => {
            const result = validateResource({
                resourceBody: { resourceType: 'Patient' },
                resourceName: 'PATIENT',
                path: '/PATIENT'
            });

            expect(result).not.toBeNull();
            expect(result.resourceType).toBe('OperationOutcome');
        });

        test('does NOT call schema validator when resourceType mismatches', () => {
            validateResource({
                resourceBody: { resourceType: 'Observation' },
                resourceName: 'Patient',
                path: '/Patient'
            });

            expect(fhirSchemaValidator.validate).not.toHaveBeenCalled();
        });
    });

    // ==========================================
    // 2. Schema validation (fhirSchemaValidator)
    // ==========================================
    describe('schema validation', () => {
        test('returns null when schema validation returns null', () => {
            fhirSchemaValidator.validate.mockReturnValue(null);

            const result = validateResource({
                resourceBody: { resourceType: 'Patient' },
                resourceName: 'Patient',
                path: '/Patient'
            });

            expect(result).toBeNull();
        });

        test('returns null when schema validation returns empty array', () => {
            fhirSchemaValidator.validate.mockReturnValue([]);

            const result = validateResource({
                resourceBody: { resourceType: 'Patient' },
                resourceName: 'Patient',
                path: '/Patient'
            });

            expect(result).toBeNull();
        });

        test('returns OperationOutcome when schema validation finds errors', () => {
            fhirSchemaValidator.validate.mockReturnValue([
                {
                    keyword: 'type',
                    message: 'should be string',
                    params: { type: 'string' },
                    dataPath: '.name'
                }
            ]);

            const result = validateResource({
                resourceBody: { resourceType: 'Patient' },
                resourceName: 'Patient',
                path: '/Patient'
            });

            expect(result).not.toBeNull();
            expect(result.resourceType).toBe('OperationOutcome');
            expect(result.issue).toHaveLength(1);
            expect(result.issue[0].severity).toBe('error');
            expect(result.issue[0].code).toBe('invalid');
        });

        test('includes error details in issue text with path, message, params, and dataPath', () => {
            fhirSchemaValidator.validate.mockReturnValue([
                {
                    keyword: 'type',
                    message: 'should be string',
                    params: { type: 'string' },
                    dataPath: '.name[0].family'
                }
            ]);

            const result = validateResource({
                resourceBody: { resourceType: 'Patient' },
                resourceName: 'Patient',
                path: '/Patient'
            });

            expect(result.issue[0].details.text).toContain('/Patient');
            expect(result.issue[0].details.text).toContain('should be string');
            expect(result.issue[0].details.text).toContain('"type":"string"');
            expect(result.issue[0].details.text).toContain('.name[0].family');
        });

        test('uses "root" when dataPath is empty string', () => {
            fhirSchemaValidator.validate.mockReturnValue([
                {
                    keyword: 'additionalProperties',
                    message: 'should NOT have additional properties',
                    params: { additionalProperty: 'foo' },
                    dataPath: ''
                }
            ]);

            const result = validateResource({
                resourceBody: { resourceType: 'Patient' },
                resourceName: 'Patient',
                path: '/Patient'
            });

            expect(result.issue[0].details.text).toContain('root');
        });

        test('handles multiple schema errors', () => {
            fhirSchemaValidator.validate.mockReturnValue([
                {
                    keyword: 'type',
                    message: 'should be string',
                    params: { type: 'string' },
                    dataPath: '.name'
                },
                {
                    keyword: 'format',
                    message: 'should match format "date"',
                    params: { format: 'date' },
                    dataPath: '.birthDate'
                },
                {
                    keyword: 'enum',
                    message: 'should be equal to one of the allowed values',
                    params: { allowedValues: ['male', 'female', 'other', 'unknown'] },
                    dataPath: '.gender'
                }
            ]);

            const result = validateResource({
                resourceBody: { resourceType: 'Patient' },
                resourceName: 'Patient',
                path: '/Patient'
            });

            expect(result.issue).toHaveLength(3);
        });

        test('calls fhirSchemaValidator.validate with the resourceBody', () => {
            const body = { resourceType: 'Patient', name: [{ family: 'Smith' }] };

            validateResource({
                resourceBody: body,
                resourceName: 'Patient',
                path: '/Patient'
            });

            expect(fhirSchemaValidator.validate).toHaveBeenCalledWith(body);
        });
    });

    // ==========================================
    // 3. Reference validation
    // ==========================================
    describe('reference validation', () => {
        test('calls validateReferences when resourceObj is instance of Resource', () => {
            const resourceObj = Object.create(Resource.prototype);
            validateReferences.mockReturnValue(null);

            validateResource({
                resourceBody: { resourceType: 'Patient' },
                resourceName: 'Patient',
                path: '/Patient',
                resourceObj
            });

            expect(validateReferences).toHaveBeenCalledWith(resourceObj);
            expect(fastValidateReferences).not.toHaveBeenCalled();
        });

        test('calls fastValidateReferences when resourceObj is NOT instance of Resource', () => {
            const resourceObj = { resourceType: 'Patient', id: '123' };
            fastValidateReferences.mockReturnValue(null);

            validateResource({
                resourceBody: { resourceType: 'Patient' },
                resourceName: 'Patient',
                path: '/Patient',
                resourceObj
            });

            expect(fastValidateReferences).toHaveBeenCalledWith(resourceObj);
            expect(validateReferences).not.toHaveBeenCalled();
        });

        test('does NOT call any reference validator when resourceObj is null', () => {
            validateResource({
                resourceBody: { resourceType: 'Patient' },
                resourceName: 'Patient',
                path: '/Patient',
                resourceObj: null
            });

            expect(validateReferences).not.toHaveBeenCalled();
            expect(fastValidateReferences).not.toHaveBeenCalled();
        });

        test('does NOT call any reference validator when resourceObj is undefined (default)', () => {
            validateResource({
                resourceBody: { resourceType: 'Patient' },
                resourceName: 'Patient',
                path: '/Patient'
            });

            expect(validateReferences).not.toHaveBeenCalled();
            expect(fastValidateReferences).not.toHaveBeenCalled();
        });

        test('returns OperationOutcome when only reference errors exist (schema passes)', () => {
            fhirSchemaValidator.validate.mockReturnValue(null);
            const resourceObj = { resourceType: 'Patient', id: '123' };
            fastValidateReferences.mockReturnValue([
                'Invalid reference: Observation/999 not found'
            ]);

            const result = validateResource({
                resourceBody: { resourceType: 'Patient' },
                resourceName: 'Patient',
                path: '/Patient',
                resourceObj
            });

            expect(result).not.toBeNull();
            expect(result.resourceType).toBe('OperationOutcome');
            expect(result.issue).toHaveLength(1);
            expect(result.issue[0].details.text).toBe('Invalid reference: Observation/999 not found');
        });

        test('combines schema errors and reference errors into one OperationOutcome', () => {
            fhirSchemaValidator.validate.mockReturnValue([
                {
                    keyword: 'type',
                    message: 'should be string',
                    params: { type: 'string' },
                    dataPath: '.name'
                }
            ]);
            const resourceObj = { resourceType: 'Patient', id: '123' };
            fastValidateReferences.mockReturnValue([
                'Invalid reference: Practitioner/abc not found',
                'Invalid reference: Organization/xyz not found'
            ]);

            const result = validateResource({
                resourceBody: { resourceType: 'Patient' },
                resourceName: 'Patient',
                path: '/Patient',
                resourceObj
            });

            expect(result).not.toBeNull();
            expect(result.issue).toHaveLength(3); // 1 schema + 2 reference
            expect(result.issue[0].details.text).toContain('should be string');
            expect(result.issue[1].details.text).toBe('Invalid reference: Practitioner/abc not found');
            expect(result.issue[2].details.text).toBe('Invalid reference: Organization/xyz not found');
        });

        test('returns null when reference errors is empty array', () => {
            fhirSchemaValidator.validate.mockReturnValue(null);
            const resourceObj = { resourceType: 'Patient', id: '123' };
            fastValidateReferences.mockReturnValue([]);

            const result = validateResource({
                resourceBody: { resourceType: 'Patient' },
                resourceName: 'Patient',
                path: '/Patient',
                resourceObj
            });

            expect(result).toBeNull();
        });
    });

    // ==========================================
    // 4. excludeRequiredFieldErrors filtering
    // ==========================================
    describe('excludeRequiredFieldErrors', () => {
        test('filters out errors with keyword "required" when excludeRequiredFieldErrors is true', () => {
            fhirSchemaValidator.validate.mockReturnValue([
                {
                    keyword: 'required',
                    message: 'should have required property "status"',
                    params: { missingProperty: 'status' },
                    dataPath: ''
                },
                {
                    keyword: 'type',
                    message: 'should be string',
                    params: { type: 'string' },
                    dataPath: '.name'
                }
            ]);

            const result = validateResource({
                resourceBody: { resourceType: 'Patient' },
                resourceName: 'Patient',
                path: '/Patient',
                excludeRequiredFieldErrors: true
            });

            expect(result).not.toBeNull();
            expect(result.issue).toHaveLength(1);
            expect(result.issue[0].details.text).toContain('should be string');
        });

        test('filters out errors with keyword "oneOf" when excludeRequiredFieldErrors is true', () => {
            fhirSchemaValidator.validate.mockReturnValue([
                {
                    keyword: 'oneOf',
                    message: 'should match exactly one schema in oneOf',
                    params: {},
                    dataPath: '.value'
                },
                {
                    keyword: 'format',
                    message: 'should match format "date"',
                    params: { format: 'date' },
                    dataPath: '.birthDate'
                }
            ]);

            const result = validateResource({
                resourceBody: { resourceType: 'Patient' },
                resourceName: 'Patient',
                path: '/Patient',
                excludeRequiredFieldErrors: true
            });

            expect(result).not.toBeNull();
            expect(result.issue).toHaveLength(1);
            expect(result.issue[0].details.text).toContain('should match format');
        });

        test('filters both "required" and "oneOf" errors simultaneously', () => {
            fhirSchemaValidator.validate.mockReturnValue([
                {
                    keyword: 'required',
                    message: 'should have required property "resourceType"',
                    params: { missingProperty: 'resourceType' },
                    dataPath: ''
                },
                {
                    keyword: 'oneOf',
                    message: 'should match exactly one schema in oneOf',
                    params: {},
                    dataPath: '.value'
                },
                {
                    keyword: 'type',
                    message: 'should be number',
                    params: { type: 'number' },
                    dataPath: '.count'
                }
            ]);

            const result = validateResource({
                resourceBody: { resourceType: 'Patient' },
                resourceName: 'Patient',
                path: '/Patient',
                excludeRequiredFieldErrors: true
            });

            expect(result).not.toBeNull();
            expect(result.issue).toHaveLength(1);
            expect(result.issue[0].details.text).toContain('should be number');
        });

        test('returns null when all errors are filtered out', () => {
            fhirSchemaValidator.validate.mockReturnValue([
                {
                    keyword: 'required',
                    message: 'should have required property "status"',
                    params: { missingProperty: 'status' },
                    dataPath: ''
                },
                {
                    keyword: 'oneOf',
                    message: 'should match exactly one schema in oneOf',
                    params: {},
                    dataPath: '.value'
                }
            ]);

            const result = validateResource({
                resourceBody: { resourceType: 'Patient' },
                resourceName: 'Patient',
                path: '/Patient',
                excludeRequiredFieldErrors: true
            });

            expect(result).toBeNull();
        });

        test('does NOT filter errors when excludeRequiredFieldErrors is false', () => {
            fhirSchemaValidator.validate.mockReturnValue([
                {
                    keyword: 'required',
                    message: 'should have required property "status"',
                    params: { missingProperty: 'status' },
                    dataPath: ''
                },
                {
                    keyword: 'oneOf',
                    message: 'should match exactly one schema in oneOf',
                    params: {},
                    dataPath: '.value'
                }
            ]);

            const result = validateResource({
                resourceBody: { resourceType: 'Patient' },
                resourceName: 'Patient',
                path: '/Patient',
                excludeRequiredFieldErrors: false
            });

            expect(result).not.toBeNull();
            expect(result.issue).toHaveLength(2);
        });

        test('does NOT filter errors when excludeRequiredFieldErrors is not provided (default false)', () => {
            fhirSchemaValidator.validate.mockReturnValue([
                {
                    keyword: 'required',
                    message: 'should have required property "status"',
                    params: { missingProperty: 'status' },
                    dataPath: ''
                }
            ]);

            const result = validateResource({
                resourceBody: { resourceType: 'Patient' },
                resourceName: 'Patient',
                path: '/Patient'
            });

            expect(result).not.toBeNull();
            expect(result.issue).toHaveLength(1);
        });

        test('CRITICAL BUG: excludeRequiredFieldErrors blindly filters ALL required errors including resourceType', () => {
            // This test documents the known bug: even critical "required" errors
            // like missing resourceType are filtered when excludeRequiredFieldErrors=true
            fhirSchemaValidator.validate.mockReturnValue([
                {
                    keyword: 'required',
                    message: 'should have required property "resourceType"',
                    params: { missingProperty: 'resourceType' },
                    dataPath: ''
                }
            ]);

            const result = validateResource({
                resourceBody: { resourceType: 'Patient' },
                resourceName: 'Patient',
                path: '/Patient',
                excludeRequiredFieldErrors: true
            });

            // The bug: even the critical resourceType required error is suppressed
            expect(result).toBeNull();
        });

        test('still enforces type mismatch errors even with excludeRequiredFieldErrors', () => {
            fhirSchemaValidator.validate.mockReturnValue([
                {
                    keyword: 'type',
                    message: 'should be object',
                    params: { type: 'object' },
                    dataPath: '.meta'
                }
            ]);

            const result = validateResource({
                resourceBody: { resourceType: 'Patient' },
                resourceName: 'Patient',
                path: '/Patient',
                excludeRequiredFieldErrors: true
            });

            expect(result).not.toBeNull();
            expect(result.issue).toHaveLength(1);
        });

        test('still enforces format errors even with excludeRequiredFieldErrors', () => {
            fhirSchemaValidator.validate.mockReturnValue([
                {
                    keyword: 'format',
                    message: 'should match format "date-time"',
                    params: { format: 'date-time' },
                    dataPath: '.meta.lastUpdated'
                }
            ]);

            const result = validateResource({
                resourceBody: { resourceType: 'Patient' },
                resourceName: 'Patient',
                path: '/Patient',
                excludeRequiredFieldErrors: true
            });

            expect(result).not.toBeNull();
            expect(result.issue).toHaveLength(1);
        });

        test('still enforces additionalProperties errors even with excludeRequiredFieldErrors', () => {
            fhirSchemaValidator.validate.mockReturnValue([
                {
                    keyword: 'additionalProperties',
                    message: 'should NOT have additional properties',
                    params: { additionalProperty: 'unknownField' },
                    dataPath: ''
                }
            ]);

            const result = validateResource({
                resourceBody: { resourceType: 'Patient' },
                resourceName: 'Patient',
                path: '/Patient',
                excludeRequiredFieldErrors: true
            });

            expect(result).not.toBeNull();
            expect(result.issue).toHaveLength(1);
        });

        test('reference errors are NOT filtered by excludeRequiredFieldErrors', () => {
            fhirSchemaValidator.validate.mockReturnValue([
                {
                    keyword: 'required',
                    message: 'should have required property "status"',
                    params: { missingProperty: 'status' },
                    dataPath: ''
                }
            ]);
            const resourceObj = { resourceType: 'Patient', id: '123' };
            fastValidateReferences.mockReturnValue([
                'Invalid reference: Practitioner/abc not found'
            ]);

            const result = validateResource({
                resourceBody: { resourceType: 'Patient' },
                resourceName: 'Patient',
                path: '/Patient',
                resourceObj,
                excludeRequiredFieldErrors: true
            });

            // required error filtered but reference error remains
            expect(result).not.toBeNull();
            expect(result.issue).toHaveLength(1);
            expect(result.issue[0].details.text).toBe('Invalid reference: Practitioner/abc not found');
        });
    });

    // ==========================================
    // 5. Return value behavior
    // ==========================================
    describe('return value', () => {
        test('returns null when no errors at all', () => {
            fhirSchemaValidator.validate.mockReturnValue(null);

            const result = validateResource({
                resourceBody: { resourceType: 'Patient' },
                resourceName: 'Patient',
                path: '/Patient'
            });

            expect(result).toBeNull();
        });

        test('returns null when schema returns empty array and no reference errors', () => {
            fhirSchemaValidator.validate.mockReturnValue([]);
            const resourceObj = { resourceType: 'Patient', id: '123' };
            fastValidateReferences.mockReturnValue([]);

            const result = validateResource({
                resourceBody: { resourceType: 'Patient' },
                resourceName: 'Patient',
                path: '/Patient',
                resourceObj
            });

            expect(result).toBeNull();
        });

        test('returns OperationOutcome with correct structure', () => {
            fhirSchemaValidator.validate.mockReturnValue([
                {
                    keyword: 'type',
                    message: 'should be string',
                    params: { type: 'string' },
                    dataPath: '.name'
                }
            ]);

            const result = validateResource({
                resourceBody: { resourceType: 'Patient' },
                resourceName: 'Patient',
                path: '/Patient'
            });

            expect(result.resourceType).toBe('OperationOutcome');
            expect(Array.isArray(result.issue)).toBe(true);
            expect(result.issue[0]).toHaveProperty('severity', 'error');
            expect(result.issue[0]).toHaveProperty('code', 'invalid');
            expect(result.issue[0]).toHaveProperty('details');
            expect(result.issue[0].details).toHaveProperty('text');
        });
    });

    // ==========================================
    // 6. Edge cases and integration scenarios
    // ==========================================
    describe('edge cases', () => {
        test('handles resourceBody with no resourceType property', () => {
            const result = validateResource({
                resourceBody: { id: '123' },
                resourceName: 'Patient',
                path: '/Patient'
            });

            // undefined !== 'Patient' so it triggers mismatch
            expect(result).not.toBeNull();
            expect(result.resourceType).toBe('OperationOutcome');
            expect(result.issue[0].details.text).toContain('ResourceType does not match the endpoint');
        });

        test('handles empty resourceBody', () => {
            const result = validateResource({
                resourceBody: {},
                resourceName: 'Patient',
                path: '/Patient'
            });

            expect(result).not.toBeNull();
            expect(result.resourceType).toBe('OperationOutcome');
        });

        test('no reference checking occurs when resourceObj is omitted (caller bug scenario)', () => {
            // Documenting that forgetting resourceObj means no reference validation
            fhirSchemaValidator.validate.mockReturnValue(null);

            const result = validateResource({
                resourceBody: { resourceType: 'Patient' },
                resourceName: 'Patient',
                path: '/Patient'
                // resourceObj intentionally omitted
            });

            expect(result).toBeNull();
            expect(validateReferences).not.toHaveBeenCalled();
            expect(fastValidateReferences).not.toHaveBeenCalled();
        });

        test('resourceType match with exact same string passes validation to schema check', () => {
            fhirSchemaValidator.validate.mockReturnValue(null);

            const result = validateResource({
                resourceBody: { resourceType: 'MedicationRequest' },
                resourceName: 'MedicationRequest',
                path: '/MedicationRequest'
            });

            expect(result).toBeNull();
            expect(fhirSchemaValidator.validate).toHaveBeenCalled();
        });

        test('schema error with null dataPath uses "root"', () => {
            fhirSchemaValidator.validate.mockReturnValue([
                {
                    keyword: 'type',
                    message: 'should be object',
                    params: { type: 'object' },
                    dataPath: null
                }
            ]);

            const result = validateResource({
                resourceBody: { resourceType: 'Patient' },
                resourceName: 'Patient',
                path: '/Patient'
            });

            expect(result.issue[0].details.text).toContain('root');
        });

        test('schema error with undefined dataPath uses "root"', () => {
            fhirSchemaValidator.validate.mockReturnValue([
                {
                    keyword: 'type',
                    message: 'should be object',
                    params: { type: 'object' },
                    dataPath: undefined
                }
            ]);

            const result = validateResource({
                resourceBody: { resourceType: 'Patient' },
                resourceName: 'Patient',
                path: '/Patient'
            });

            expect(result.issue[0].details.text).toContain('root');
        });

        test('validates with Resource instance using validateReferences that returns errors', () => {
            fhirSchemaValidator.validate.mockReturnValue(null);
            const resourceObj = Object.create(Resource.prototype);
            validateReferences.mockReturnValue([
                'Reference Patient/missing does not exist'
            ]);

            const result = validateResource({
                resourceBody: { resourceType: 'Patient' },
                resourceName: 'Patient',
                path: '/Patient',
                resourceObj
            });

            expect(result).not.toBeNull();
            expect(result.issue).toHaveLength(1);
            expect(result.issue[0].details.text).toBe('Reference Patient/missing does not exist');
        });

        test('multiple reference errors are all included in OperationOutcome', () => {
            fhirSchemaValidator.validate.mockReturnValue(null);
            const resourceObj = { resourceType: 'Patient', id: '123' };
            fastValidateReferences.mockReturnValue([
                'Invalid reference: Practitioner/1',
                'Invalid reference: Organization/2',
                'Invalid reference: Location/3'
            ]);

            const result = validateResource({
                resourceBody: { resourceType: 'Patient' },
                resourceName: 'Patient',
                path: '/Patient',
                resourceObj
            });

            expect(result.issue).toHaveLength(3);
        });
    });

    // ==========================================
    // 7. Smart merge ($merge stage 8) scenario
    // ==========================================
    describe('smart merge scenario (excludeRequiredFieldErrors=true)', () => {
        test('allows resource with missing required fields during smart merge', () => {
            // Simulates $merge stage 8: smartMerge=true passes excludeRequiredFieldErrors=true
            fhirSchemaValidator.validate.mockReturnValue([
                {
                    keyword: 'required',
                    message: 'should have required property "status"',
                    params: { missingProperty: 'status' },
                    dataPath: ''
                },
                {
                    keyword: 'required',
                    message: 'should have required property "code"',
                    params: { missingProperty: 'code' },
                    dataPath: ''
                },
                {
                    keyword: 'oneOf',
                    message: 'should match exactly one schema in oneOf',
                    params: {},
                    dataPath: '.value'
                }
            ]);

            const result = validateResource({
                resourceBody: { resourceType: 'Condition' },
                resourceName: 'Condition',
                path: '/Condition',
                excludeRequiredFieldErrors: true
            });

            // All errors are required/oneOf so all filtered
            expect(result).toBeNull();
        });

        test('rejects resource with invalid format during smart merge', () => {
            // Even in smart merge, type/format errors are still enforced
            fhirSchemaValidator.validate.mockReturnValue([
                {
                    keyword: 'required',
                    message: 'should have required property "status"',
                    params: { missingProperty: 'status' },
                    dataPath: ''
                },
                {
                    keyword: 'format',
                    message: 'should match format "date"',
                    params: { format: 'date' },
                    dataPath: '.onsetDateTime'
                }
            ]);

            const result = validateResource({
                resourceBody: { resourceType: 'Condition' },
                resourceName: 'Condition',
                path: '/Condition',
                excludeRequiredFieldErrors: true
            });

            expect(result).not.toBeNull();
            expect(result.issue).toHaveLength(1);
            expect(result.issue[0].details.text).toContain('should match format');
        });
    });
});
