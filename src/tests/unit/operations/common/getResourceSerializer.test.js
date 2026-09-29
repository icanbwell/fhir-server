'use strict';

const { describe, test, expect, beforeEach, jest: jestObj } = require('@jest/globals');

const mockResolveSerialzier = jestObj.fn();
jestObj.mock('../../../../middleware/fhir/utils/serializer.util', () => ({
    resolveSerialzier: mockResolveSerialzier
}));

const { getResourceSerializer, getResourceSerializerByName } = require('../../../../operations/common/getResourceSerializer');

describe('getResourceSerializer', () => {
    beforeEach(() => {
        mockResolveSerialzier.mockReset();
    });

    describe('getResourceSerializer', () => {
        test('calls resolveSerialzier with base_version and resource_name + "serializer" suffix', () => {
            const mockSerializer = { serialize: (obj) => obj };
            mockResolveSerialzier.mockReturnValue(mockSerializer);

            const result = getResourceSerializer('4_0_0', 'Patient');

            expect(mockResolveSerialzier).toHaveBeenCalledWith('4_0_0', 'Patientserializer');
            expect(result).toBe(mockSerializer);
        });

        test('appends "serializer" suffix to the resource_name', () => {
            mockResolveSerialzier.mockReturnValue(undefined);

            getResourceSerializer('4_0_0', 'Observation');

            expect(mockResolveSerialzier).toHaveBeenCalledWith('4_0_0', 'Observationserializer');
        });

        test('returns undefined when serializer not found', () => {
            mockResolveSerialzier.mockReturnValue(undefined);

            const result = getResourceSerializer('4_0_0', 'UnknownResource');

            expect(result).toBeUndefined();
        });

        test('passes different base_version values correctly', () => {
            mockResolveSerialzier.mockReturnValue(null);

            getResourceSerializer('3_0_1', 'Patient');

            expect(mockResolveSerialzier).toHaveBeenCalledWith('3_0_1', 'Patientserializer');
        });
    });

    describe('getResourceSerializerByName', () => {
        test('calls resolveSerialzier with base_version and serializer_name directly', () => {
            const mockSerializer = { serialize: (obj) => obj };
            mockResolveSerialzier.mockReturnValue(mockSerializer);

            const result = getResourceSerializerByName('4_0_0', 'patientserializer');

            expect(mockResolveSerialzier).toHaveBeenCalledWith('4_0_0', 'patientserializer');
            expect(result).toBe(mockSerializer);
        });

        test('does not append any suffix to serializer_name', () => {
            mockResolveSerialzier.mockReturnValue(null);

            getResourceSerializerByName('4_0_0', 'customserializer');

            expect(mockResolveSerialzier).toHaveBeenCalledWith('4_0_0', 'customserializer');
        });

        test('returns undefined when serializer not found', () => {
            mockResolveSerialzier.mockReturnValue(undefined);

            const result = getResourceSerializerByName('4_0_0', 'nonexistent');

            expect(result).toBeUndefined();
        });

        test('passes base_version and name without modification', () => {
            mockResolveSerialzier.mockReturnValue(null);

            getResourceSerializerByName('4_0_0', 'BundleSerializer');

            expect(mockResolveSerialzier).toHaveBeenCalledWith('4_0_0', 'BundleSerializer');
        });
    });
});
