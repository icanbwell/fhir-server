const { describe, test, expect, jest: jestObj, beforeEach } = require('@jest/globals');

// Mock dependencies
jestObj.mock('../../../../../middleware/fhir/utils/conformance.utils', () => ({
    getSearchParams: jestObj.fn()
}));

const { resource } = require('../../../../../middleware/fhir/metadata/capability.template');
const { getSearchParams } = require('../../../../../middleware/fhir/utils/conformance.utils');

describe('capability.template', () => {
    beforeEach(() => {
        jestObj.clearAllMocks();
    });

    describe('resource', () => {
        test('returns a conformance resource object whose type is the profile key', () => {
            const mockSearchParams = [
                { name: 'name', type: 'string' },
                { name: 'identifier', type: 'token' }
            ];
            getSearchParams.mockReturnValue(mockSearchParams);

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

            resource('4_0_0', 'Observation');

            expect(getSearchParams).toHaveBeenCalledWith('Observation', '4_0_0');
        });

        test('uses the key for the type field', () => {
            getSearchParams.mockReturnValue([]);

            const result = resource('4_0_0', 'MedicationRequest');

            expect(result.type).toBe('MedicationRequest');
        });

        test('builds profile reference URL using the key parameter', () => {
            getSearchParams.mockReturnValue([]);

            const result = resource('4_0_0', 'Encounter');

            expect(result.profile.reference).toBe('http://hl7.org/fhir/Encounter.html');
        });

        test('always sets conditionalDelete to not-supported', () => {
            getSearchParams.mockReturnValue([]);

            const result = resource('4_0_0', 'AllergyIntolerance');

            expect(result.conditionalDelete).toBe('not-supported');
        });

        test('returns empty searchParam when getSearchParams returns empty array', () => {
            getSearchParams.mockReturnValue([]);

            const result = resource('4_0_0', 'Procedure');

            expect(result.searchParam).toEqual([]);
        });

        test('asks for the search params of the key and version', () => {
            getSearchParams.mockReturnValue([]);

            resource('4_0_0', 'Patient');

            expect(getSearchParams).toHaveBeenCalledWith('Patient', '4_0_0');
        });
    });
});
