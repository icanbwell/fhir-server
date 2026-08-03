'use strict';

const { describe, test, expect, beforeEach, jest: jestObj } = require('@jest/globals');

const mockResolveSchema = jestObj.fn();
jestObj.mock('../../../../middleware/fhir/utils/schema.utils', () => ({
    resolveSchema: mockResolveSchema
}));

const { getResource } = require('../../../../operations/common/getResource');

describe('getResource', () => {
    beforeEach(() => {
        mockResolveSchema.mockReset();
    });

    test('calls resolveSchema with provided base_version and resource_name', () => {
        const mockClass = class Patient {};
        mockResolveSchema.mockReturnValue(mockClass);

        const result = getResource('4_0_0', 'Patient');

        expect(mockResolveSchema).toHaveBeenCalledWith('4_0_0', 'Patient');
        expect(result).toBe(mockClass);
    });

    test('returns result from resolveSchema for different resource types', () => {
        const mockClass = class Observation {};
        mockResolveSchema.mockReturnValue(mockClass);

        const result = getResource('4_0_0', 'Observation');

        expect(mockResolveSchema).toHaveBeenCalledWith('4_0_0', 'Observation');
        expect(result).toBe(mockClass);
    });

    test('returns undefined when resolveSchema returns undefined for unknown resource', () => {
        mockResolveSchema.mockReturnValue(undefined);

        const result = getResource('4_0_0', 'UnknownResource');

        expect(mockResolveSchema).toHaveBeenCalledWith('4_0_0', 'UnknownResource');
        expect(result).toBeUndefined();
    });

    test('passes base_version correctly for different versions', () => {
        mockResolveSchema.mockReturnValue(null);

        getResource('3_0_1', 'Patient');

        expect(mockResolveSchema).toHaveBeenCalledWith('3_0_1', 'Patient');
    });

    test('does not alter the resource_name before passing to resolveSchema', () => {
        mockResolveSchema.mockReturnValue(null);

        getResource('4_0_0', 'MedicationRequest');

        expect(mockResolveSchema).toHaveBeenCalledWith('4_0_0', 'MedicationRequest');
    });
});
