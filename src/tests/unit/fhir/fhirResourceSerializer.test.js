'use strict';

const { describe, test, expect, beforeEach, jest: jestObj } = require('@jest/globals');

// Mock the getResourceSerializer module
const mockSerialize = jestObj.fn();
const mockSerializer = { serialize: mockSerialize };

jestObj.mock('../../../operations/common/getResourceSerializer', () => ({
    getResourceSerializer: jestObj.fn()
}));

jestObj.mock('../../../middleware/fhir/utils/constants', () => ({
    VERSIONS: { '4_0_0': '4_0_0' }
}));

jestObj.mock('../../../utils/rethrownError', () => ({
    RethrownError: class RethrownError extends Error {
        constructor({ message, error, args, source }) {
            super(message);
            this.innerError = error;
            this.args = args;
            this.source = source;
        }
    }
}));

jestObj.mock('../../../utils/httpErrors', () => ({
    BadRequestError: class BadRequestError extends Error {
        constructor(error) {
            super(error.message);
            this.statusCode = 400;
        }
    }
}));

const { FhirResourceSerializer } = require('../../../fhir/fhirResourceSerializer');
const { getResourceSerializer } = require('../../../operations/common/getResourceSerializer');

describe('FhirResourceSerializer', () => {
    beforeEach(() => {
        jestObj.clearAllMocks();
        mockSerialize.mockReset();
    });

    describe('serialize', () => {
        test('returns null when obj is null', () => {
            const result = FhirResourceSerializer.serialize(null);
            expect(result).toBeNull();
        });

        test('returns undefined when obj is undefined', () => {
            const result = FhirResourceSerializer.serialize(undefined);
            expect(result).toBeUndefined();
        });

        test('returns falsy value as-is when obj is empty string', () => {
            const result = FhirResourceSerializer.serialize('');
            expect(result).toBe('');
        });

        test('returns falsy value as-is when obj is 0', () => {
            const result = FhirResourceSerializer.serialize(0);
            expect(result).toBe(0);
        });

        test('uses provided SerializerClass when given', () => {
            const mockCustomSerialize = jestObj.fn().mockReturnValue({ id: '1', serialized: true });
            const SerializerClass = { serialize: mockCustomSerialize };
            const obj = { resourceType: 'Patient', id: '1' };

            const result = FhirResourceSerializer.serialize(obj, SerializerClass);

            expect(mockCustomSerialize).toHaveBeenCalledWith(obj);
            expect(result).toEqual({ id: '1', serialized: true });
            // Should NOT call getResourceSerializer when SerializerClass is provided
            expect(getResourceSerializer).not.toHaveBeenCalled();
        });

        test('throws RethrownError when obj has no resourceType and no SerializerClass', () => {
            const obj = { id: '1' };

            try {
                FhirResourceSerializer.serialize(obj);
                throw new Error('should have thrown');
            } catch (e) {
                expect(e.message).toBe('Error in serializing resource');
                expect(e.innerError.message).toBe('resourceType is null');
                expect(e.innerError.statusCode).toBe(400);
                expect(e.source).toBe('FhirResourceSerializer.serialize');
            }
        });

        test('looks up serializer by resourceType and version 4_0_0', () => {
            mockSerialize.mockReturnValue({ id: '1', done: true });
            getResourceSerializer.mockReturnValue(mockSerializer);
            const obj = { resourceType: 'Patient', id: '1' };

            const result = FhirResourceSerializer.serialize(obj);

            expect(getResourceSerializer).toHaveBeenCalledWith('4_0_0', 'Patient');
            expect(mockSerialize).toHaveBeenCalledWith(obj);
            expect(result).toEqual({ id: '1', done: true });
        });

        test('throws RethrownError when serializer is not found for resourceType', () => {
            getResourceSerializer.mockReturnValue(null);
            const obj = { resourceType: 'UnsupportedType', id: '2' };

            try {
                FhirResourceSerializer.serialize(obj);
                throw new Error('should have thrown');
            } catch (e) {
                expect(e.message).toBe('Error in serializing resource');
                expect(e.innerError.message).toBe('Serialization of ResourceType UnsupportedType is not supported');
                expect(e.innerError.statusCode).toBe(400);
                expect(e.source).toBe('FhirResourceSerializer.serialize');
            }
        });

        test('throws RethrownError when serializer.serialize throws', () => {
            mockSerialize.mockImplementation(() => { throw new Error('serialize failed'); });
            getResourceSerializer.mockReturnValue(mockSerializer);
            const obj = { resourceType: 'Patient', id: '3' };

            try {
                FhirResourceSerializer.serialize(obj);
                throw new Error('should have thrown');
            } catch (e) {
                expect(e.message).toBe('Error in serializing resource');
                expect(e.innerError.message).toBe('serialize failed');
                expect(e.args.resource).toBe(obj);
                expect(e.source).toBe('FhirResourceSerializer.serialize');
            }
        });

        test('throws RethrownError when SerializerClass.serialize throws', () => {
            const SerializerClass = {
                serialize: jestObj.fn().mockImplementation(() => { throw new Error('custom serialize failed'); })
            };
            const obj = { resourceType: 'Patient', id: '4' };

            try {
                FhirResourceSerializer.serialize(obj, SerializerClass);
                throw new Error('should have thrown');
            } catch (e) {
                expect(e.message).toBe('Error in serializing resource');
                expect(e.innerError.message).toBe('custom serialize failed');
                expect(e.args.resource).toBe(obj);
                expect(e.source).toBe('FhirResourceSerializer.serialize');
            }
        });

        test('works with different resourceTypes', () => {
            const mockObs = { serialize: jestObj.fn().mockReturnValue({ type: 'obs' }) };
            getResourceSerializer.mockReturnValue(mockObs);
            const obj = { resourceType: 'Observation', id: '5' };

            const result = FhirResourceSerializer.serialize(obj);

            expect(getResourceSerializer).toHaveBeenCalledWith('4_0_0', 'Observation');
            expect(result).toEqual({ type: 'obs' });
        });
    });

    describe('serializeByResourceType', () => {
        test('returns null when obj is null', () => {
            const result = FhirResourceSerializer.serializeByResourceType(null, 'Patient');
            expect(result).toBeNull();
        });

        test('returns undefined when obj is undefined', () => {
            const result = FhirResourceSerializer.serializeByResourceType(undefined, 'Patient');
            expect(result).toBeUndefined();
        });

        test('returns falsy value as-is when obj is 0', () => {
            const result = FhirResourceSerializer.serializeByResourceType(0, 'Patient');
            expect(result).toBe(0);
        });

        test('serializes using specified resourceType regardless of obj.resourceType', () => {
            mockSerialize.mockReturnValue({ typed: true });
            getResourceSerializer.mockReturnValue(mockSerializer);
            const obj = { resourceType: 'Patient', id: '1' };

            const result = FhirResourceSerializer.serializeByResourceType(obj, 'Observation');

            expect(getResourceSerializer).toHaveBeenCalledWith('4_0_0', 'Observation');
            expect(mockSerialize).toHaveBeenCalledWith(obj);
            expect(result).toEqual({ typed: true });
        });

        test('serializes object without resourceType using explicit type parameter', () => {
            mockSerialize.mockReturnValue({ noType: true });
            getResourceSerializer.mockReturnValue(mockSerializer);
            const obj = { id: '2', name: 'test' };

            const result = FhirResourceSerializer.serializeByResourceType(obj, 'Bundle');

            expect(getResourceSerializer).toHaveBeenCalledWith('4_0_0', 'Bundle');
            expect(mockSerialize).toHaveBeenCalledWith(obj);
            expect(result).toEqual({ noType: true });
        });

        test('throws RethrownError when serializer not found', () => {
            getResourceSerializer.mockReturnValue(undefined);
            const obj = { id: '3' };

            try {
                FhirResourceSerializer.serializeByResourceType(obj, 'NonExistentType');
                throw new Error('should have thrown');
            } catch (e) {
                expect(e.message).toBe('Error in serializing resource');
                expect(e.args.resource).toBe(obj);
                expect(e.source).toBe('FhirResourceSerializer.serializeByResourceType');
            }
        });

        test('throws RethrownError when serializer.serialize throws', () => {
            mockSerialize.mockImplementation(() => { throw new Error('type serialize failed'); });
            getResourceSerializer.mockReturnValue(mockSerializer);
            const obj = { id: '4' };

            try {
                FhirResourceSerializer.serializeByResourceType(obj, 'Patient');
                throw new Error('should have thrown');
            } catch (e) {
                expect(e.message).toBe('Error in serializing resource');
                expect(e.innerError.message).toBe('type serialize failed');
                expect(e.source).toBe('FhirResourceSerializer.serializeByResourceType');
            }
        });
    });

    describe('serializeArray', () => {
        test('returns null when obj is null', () => {
            const result = FhirResourceSerializer.serializeArray(null);
            expect(result).toBeNull();
        });

        test('returns undefined when obj is undefined', () => {
            const result = FhirResourceSerializer.serializeArray(undefined);
            expect(result).toBeUndefined();
        });

        test('returns falsy as-is when obj is 0', () => {
            const result = FhirResourceSerializer.serializeArray(0);
            expect(result).toBe(0);
        });

        test('serializes each item in array', () => {
            mockSerialize.mockImplementation((o) => ({ ...o, serialized: true }));
            getResourceSerializer.mockReturnValue(mockSerializer);
            const arr = [
                { resourceType: 'Patient', id: '1' },
                { resourceType: 'Patient', id: '2' }
            ];

            const result = FhirResourceSerializer.serializeArray(arr);

            expect(result).toHaveLength(2);
            expect(result[0]).toEqual({ resourceType: 'Patient', id: '1', serialized: true });
            expect(result[1]).toEqual({ resourceType: 'Patient', id: '2', serialized: true });
        });

        test('filters out null and undefined values from array before serializing', () => {
            mockSerialize.mockImplementation((o) => ({ ...o, done: true }));
            getResourceSerializer.mockReturnValue(mockSerializer);
            const arr = [
                { resourceType: 'Patient', id: '1' },
                null,
                undefined,
                { resourceType: 'Patient', id: '2' }
            ];

            const result = FhirResourceSerializer.serializeArray(arr);

            expect(result).toHaveLength(2);
            expect(result[0].id).toBe('1');
            expect(result[1].id).toBe('2');
        });

        test('wraps single non-array object in array', () => {
            mockSerialize.mockReturnValue({ wrapped: true });
            getResourceSerializer.mockReturnValue(mockSerializer);
            const obj = { resourceType: 'Patient', id: '1' };

            const result = FhirResourceSerializer.serializeArray(obj);

            expect(Array.isArray(result)).toBe(true);
            expect(result).toHaveLength(1);
            expect(result[0]).toEqual({ wrapped: true });
        });

        test('uses provided SerializerClass for each item in array', () => {
            const customSerialize = jestObj.fn().mockReturnValue({ custom: true });
            const SerializerClass = { serialize: customSerialize };
            const arr = [
                { resourceType: 'Patient', id: '1' },
                { resourceType: 'Patient', id: '2' }
            ];

            const result = FhirResourceSerializer.serializeArray(arr, SerializerClass);

            expect(customSerialize).toHaveBeenCalledTimes(2);
            expect(result).toHaveLength(2);
            expect(result[0]).toEqual({ custom: true });
            expect(result[1]).toEqual({ custom: true });
            expect(getResourceSerializer).not.toHaveBeenCalled();
        });

        test('uses provided SerializerClass for single non-array object', () => {
            const customSerialize = jestObj.fn().mockReturnValue({ single: true });
            const SerializerClass = { serialize: customSerialize };
            const obj = { resourceType: 'Observation', id: '1' };

            const result = FhirResourceSerializer.serializeArray(obj, SerializerClass);

            expect(customSerialize).toHaveBeenCalledTimes(1);
            expect(result).toEqual([{ single: true }]);
        });

        test('throws RethrownError when serialization fails on array item', () => {
            mockSerialize.mockImplementation(() => { throw new Error('array item fail'); });
            getResourceSerializer.mockReturnValue(mockSerializer);
            const arr = [{ resourceType: 'Patient', id: '1' }];

            try {
                FhirResourceSerializer.serializeArray(arr);
                throw new Error('should have thrown');
            } catch (e) {
                expect(e.message).toBe('Error in serializing resource');
                expect(e.source).toBe('FhirResourceSerializer.serializeArray');
            }
        });

        test('throws RethrownError when serialization fails on non-array object', () => {
            mockSerialize.mockImplementation(() => { throw new Error('single fail'); });
            getResourceSerializer.mockReturnValue(mockSerializer);
            const obj = { resourceType: 'Patient', id: '1' };

            try {
                FhirResourceSerializer.serializeArray(obj);
                throw new Error('should have thrown');
            } catch (e) {
                expect(e.message).toBe('Error in serializing resource');
                expect(e.source).toBe('FhirResourceSerializer.serializeArray');
            }
        });

        test('returns empty array when array has only null/undefined items', () => {
            const arr = [null, undefined, null];

            // Since all items are filtered out, map returns empty array
            const result = FhirResourceSerializer.serializeArray(arr);
            expect(result).toEqual([]);
        });

        test('handles array with mixed resource types', () => {
            const patientSerializer = { serialize: jestObj.fn().mockReturnValue({ type: 'patient' }) };
            const obsSerializer = { serialize: jestObj.fn().mockReturnValue({ type: 'obs' }) };
            getResourceSerializer.mockImplementation((version, resourceType) => {
                if (resourceType === 'Patient') return patientSerializer;
                if (resourceType === 'Observation') return obsSerializer;
                return null;
            });

            const arr = [
                { resourceType: 'Patient', id: '1' },
                { resourceType: 'Observation', id: '2' }
            ];

            const result = FhirResourceSerializer.serializeArray(arr);

            expect(result).toHaveLength(2);
            expect(result[0]).toEqual({ type: 'patient' });
            expect(result[1]).toEqual({ type: 'obs' });
        });

        test('includes original array as resource in error args', () => {
            mockSerialize.mockImplementation(() => { throw new Error('boom'); });
            getResourceSerializer.mockReturnValue(mockSerializer);
            const arr = [{ resourceType: 'Patient', id: '1' }];

            try {
                FhirResourceSerializer.serializeArray(arr);
                throw new Error('should have thrown');
            } catch (e) {
                expect(e.args.resource).toBe(arr);
            }
        });
    });
});
