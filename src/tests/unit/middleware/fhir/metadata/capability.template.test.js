const { describe, test, expect, jest: jestObj, beforeEach } = require('@jest/globals');

// Mock dependencies
jestObj.mock('../../../../../middleware/fhir/utils/conformance.utils', () => ({
    getSearchParams: jestObj.fn()
}));

jestObj.mock('../../../../../middleware/fhir/utils/schema.utils', () => ({
    resolveSchema: jestObj.fn()
}));

const { resource } = require('../../../../../middleware/fhir/metadata/capability.template');
const { getSearchParams } = require('../../../../../middleware/fhir/utils/conformance.utils');
const { resolveSchema } = require('../../../../../middleware/fhir/utils/schema.utils');

describe('capability.template', () => {
    beforeEach(() => {
        jestObj.clearAllMocks();
    });

    describe('resource', () => {
        test('returns a conformance resource object with correct type from resolved schema', () => {
            const mockSearchParams = [
                { name: 'name', type: 'string' },
                { name: 'identifier', type: 'token' }
            ];
            getSearchParams.mockReturnValue(mockSearchParams);
            resolveSchema.mockReturnValue({ resourceType: 'Patient' });

            const result = resource('4_0_0', 'Patient');

            expect(result).toEqual({
                type: 'Patient',
                profile: {
                    reference: 'http://hl7.org/fhir/Patient.html'
                },
                conditionalDelete: 'not-supported',
                searchParam: mockSearchParams
            });
        });

        test('calls getSearchParams with key and baseVersion', () => {
            getSearchParams.mockReturnValue([]);
            resolveSchema.mockReturnValue({ resourceType: 'Observation' });

            resource('4_0_0', 'Observation');

            expect(getSearchParams).toHaveBeenCalledWith('Observation', '4_0_0');
        });

        test('calls resolveSchema with baseVersion and key', () => {
            getSearchParams.mockReturnValue([]);
            resolveSchema.mockReturnValue({ resourceType: 'Condition' });

            resource('4_0_0', 'Condition');

            expect(resolveSchema).toHaveBeenCalledWith('4_0_0', 'Condition');
        });

        test('uses resourceType from resolved schema for type field', () => {
            getSearchParams.mockReturnValue([]);
            resolveSchema.mockReturnValue({ resourceType: 'MedicationRequest' });

            const result = resource('4_0_0', 'MedicationRequest');

            expect(result.type).toBe('MedicationRequest');
        });

        test('builds profile reference URL using the key parameter', () => {
            getSearchParams.mockReturnValue([]);
            resolveSchema.mockReturnValue({ resourceType: 'Encounter' });

            const result = resource('4_0_0', 'Encounter');

            expect(result.profile.reference).toBe('http://hl7.org/fhir/Encounter.html');
        });

        test('always sets conditionalDelete to not-supported', () => {
            getSearchParams.mockReturnValue([]);
            resolveSchema.mockReturnValue({ resourceType: 'AllergyIntolerance' });

            const result = resource('4_0_0', 'AllergyIntolerance');

            expect(result.conditionalDelete).toBe('not-supported');
        });

        test('returns empty searchParam when getSearchParams returns empty array', () => {
            getSearchParams.mockReturnValue([]);
            resolveSchema.mockReturnValue({ resourceType: 'Procedure' });

            const result = resource('4_0_0', 'Procedure');

            expect(result.searchParam).toEqual([]);
        });

        test('works with different FHIR versions', () => {
            getSearchParams.mockReturnValue([]);
            resolveSchema.mockReturnValue({ resourceType: 'Patient' });

            resource('3_0_1', 'Patient');

            expect(getSearchParams).toHaveBeenCalledWith('Patient', '3_0_1');
            expect(resolveSchema).toHaveBeenCalledWith('3_0_1', 'Patient');
        });
    });
});
