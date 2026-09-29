'use strict';

const { describe, test, expect, beforeEach, jest: jestObj } = require('@jest/globals');

// Mock dependencies
const mockReadSerialize = jestObj.fn();
const mockSerializerR4B = {};
const mockSerializerComplexTypeR4B = {};
const mockSerializersCustom = {};

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

jestObj.mock('../../../fhir/writeSerializers/4_0_0/resources', () => mockSerializerR4B);
jestObj.mock('../../../fhir/writeSerializers/4_0_0/complexTypes', () => mockSerializerComplexTypeR4B);
jestObj.mock('../../../fhir/writeSerializers/4_0_0/customSerializers', () => mockSerializersCustom);

const { FhirResourceReadSerializer } = require('../../../fhir/fhirResourceReadSerializer');

describe('FhirResourceReadSerializer', () => {
    beforeEach(() => {
        mockReadSerialize.mockReset();

        // Clean mock serializer registries
        Object.keys(mockSerializerR4B).forEach((k) => delete mockSerializerR4B[k]);
        Object.keys(mockSerializerComplexTypeR4B).forEach((k) => delete mockSerializerComplexTypeR4B[k]);
        Object.keys(mockSerializersCustom).forEach((k) => delete mockSerializersCustom[k]);
    });

    describe('serializerMethod', () => {
        test('has serializerMethod set to readSerialize', () => {
            expect(FhirResourceReadSerializer.serializerMethod).toBe('readSerialize');
        });

        test('serializerMethod is a static property not inherited from BaseFhirResourceSerializer base value', () => {
            // BaseFhirResourceSerializer.serializerMethod is null
            // FhirResourceReadSerializer must override it
            expect(FhirResourceReadSerializer.serializerMethod).not.toBeNull();
        });
    });

    describe('serialize', () => {
        test('returns null when obj is null', () => {
            const result = FhirResourceReadSerializer.serialize({ obj: null });
            expect(result).toBeNull();
        });

        test('returns undefined when obj is undefined', () => {
            const result = FhirResourceReadSerializer.serialize({ obj: undefined });
            expect(result).toBeUndefined();
        });

        test('uses provided SerializerClass.readSerialize when given', () => {
            const SerializerClass = {
                readSerialize: jestObj.fn().mockReturnValue({ id: '1', read: true })
            };
            const obj = { resourceType: 'Patient', id: '1' };

            const result = FhirResourceReadSerializer.serialize({ obj, SerializerClass });

            expect(SerializerClass.readSerialize).toHaveBeenCalledWith(obj, { resourceType: 'Patient' });
            expect(result).toEqual({ id: '1', read: true });
        });

        test('passes context merged with resourceType to SerializerClass.readSerialize', () => {
            const SerializerClass = {
                readSerialize: jestObj.fn().mockReturnValue({})
            };
            const obj = { resourceType: 'Observation', id: '2' };
            const context = { requestId: 'req-abc' };

            FhirResourceReadSerializer.serialize({ obj, SerializerClass, context });

            expect(SerializerClass.readSerialize).toHaveBeenCalledWith(obj, {
                requestId: 'req-abc',
                resourceType: 'Observation'
            });
        });

        test('does not add resourceType to context when obj lacks resourceType', () => {
            const SerializerClass = {
                readSerialize: jestObj.fn().mockReturnValue({})
            };
            const obj = { id: '3' };
            const context = { foo: 'bar' };

            FhirResourceReadSerializer.serialize({ obj, SerializerClass, context });

            expect(SerializerClass.readSerialize).toHaveBeenCalledWith(obj, { foo: 'bar' });
        });

        test('throws RethrownError when obj has no resourceType and no SerializerClass', () => {
            const obj = { id: '4' };

            try {
                FhirResourceReadSerializer.serialize({ obj });
                throw new Error('should have thrown');
            } catch (e) {
                expect(e.message).toBe('Error in serializing resource');
                expect(e.innerError.message).toBe('resourceType is null');
                expect(e.innerError.statusCode).toBe(400);
            }
        });

        test('looks up serializer from resources registry by lowercased first char + Serializer', () => {
            mockSerializerR4B.patientSerializer = {
                readSerialize: jestObj.fn().mockReturnValue({ found: 'resources' })
            };
            const obj = { resourceType: 'Patient', id: '5' };

            const result = FhirResourceReadSerializer.serialize({ obj });

            expect(mockSerializerR4B.patientSerializer.readSerialize).toHaveBeenCalledWith(obj, { resourceType: 'Patient' });
            expect(result).toEqual({ found: 'resources' });
        });

        test('looks up serializer from complexTypes registry if not in resources', () => {
            mockSerializerComplexTypeR4B.addressSerializer = {
                readSerialize: jestObj.fn().mockReturnValue({ found: 'complex' })
            };
            const obj = { resourceType: 'Address', id: '6' };

            const result = FhirResourceReadSerializer.serialize({ obj });

            expect(result).toEqual({ found: 'complex' });
        });

        test('looks up serializer from custom registry if not in resources or complexTypes', () => {
            mockSerializersCustom.bundleSerializer = {
                readSerialize: jestObj.fn().mockReturnValue({ found: 'custom' })
            };
            const obj = { resourceType: 'Bundle', id: '7' };

            const result = FhirResourceReadSerializer.serialize({ obj });

            expect(result).toEqual({ found: 'custom' });
        });

        test('throws RethrownError for unsupported resourceType', () => {
            const obj = { resourceType: 'UnknownResource', id: '8' };

            try {
                FhirResourceReadSerializer.serialize({ obj });
                throw new Error('should have thrown');
            } catch (e) {
                expect(e.message).toBe('Error in serializing resource');
                expect(e.innerError.message).toBe('ResourceType UnknownResource is not supported');
            }
        });

        test('includes resource in error args and correct source when serializer throws', () => {
            mockSerializerR4B.patientSerializer = {
                readSerialize: jestObj.fn().mockImplementation(() => { throw new Error('read failed'); })
            };
            const obj = { resourceType: 'Patient', id: '9' };

            try {
                FhirResourceReadSerializer.serialize({ obj });
                throw new Error('should have thrown');
            } catch (e) {
                expect(e.args.resource).toBe(obj);
                expect(e.source).toBe('FhirResourceReadSerializer.serialize');
            }
        });
    });

    describe('serializeByResourceType', () => {
        test('returns null when obj is null', () => {
            const result = FhirResourceReadSerializer.serializeByResourceType({ obj: null, resourceType: 'Patient' });
            expect(result).toBeNull();
        });

        test('returns undefined when obj is undefined', () => {
            const result = FhirResourceReadSerializer.serializeByResourceType({ obj: undefined, resourceType: 'Patient' });
            expect(result).toBeUndefined();
        });

        test('serializes using specified resourceType regardless of obj.resourceType', () => {
            mockSerializerR4B.observationSerializer = {
                readSerialize: jestObj.fn().mockReturnValue({ typed: true })
            };
            const obj = { resourceType: 'Patient', id: '10' };

            const result = FhirResourceReadSerializer.serializeByResourceType({ obj, resourceType: 'Observation' });

            expect(mockSerializerR4B.observationSerializer.readSerialize).toHaveBeenCalledWith(obj, { resourceType: 'Observation' });
            expect(result).toEqual({ typed: true });
        });

        test('passes context merged with resourceType', () => {
            mockSerializerR4B.patientSerializer = {
                readSerialize: jestObj.fn().mockReturnValue({})
            };
            const context = { user: 'admin' };

            FhirResourceReadSerializer.serializeByResourceType({
                obj: { id: '11' },
                resourceType: 'Patient',
                context
            });

            expect(mockSerializerR4B.patientSerializer.readSerialize).toHaveBeenCalledWith(
                { id: '11' },
                { user: 'admin', resourceType: 'Patient' }
            );
        });

        test('throws RethrownError when serializer not found', () => {
            try {
                FhirResourceReadSerializer.serializeByResourceType({ obj: { id: '12' }, resourceType: 'Missing' });
                throw new Error('should have thrown');
            } catch (e) {
                expect(e.message).toBe('Error in serializing resource');
                expect(e.source).toBe('FhirResourceReadSerializer.serializeByResourceType');
            }
        });

        test('throws RethrownError when readSerialize method throws', () => {
            mockSerializerR4B.patientSerializer = {
                readSerialize: jestObj.fn().mockImplementation(() => { throw new Error('read type fail'); })
            };

            try {
                FhirResourceReadSerializer.serializeByResourceType({ obj: { id: '13' }, resourceType: 'Patient' });
                throw new Error('should have thrown');
            } catch (e) {
                expect(e.message).toBe('Error in serializing resource');
                expect(e.innerError.message).toBe('read type fail');
            }
        });
    });

    describe('serializeArray', () => {
        test('returns null when obj is null', () => {
            const result = FhirResourceReadSerializer.serializeArray({ obj: null });
            expect(result).toBeNull();
        });

        test('returns undefined when obj is undefined', () => {
            const result = FhirResourceReadSerializer.serializeArray({ obj: undefined });
            expect(result).toBeUndefined();
        });

        test('serializes each item in array using readSerialize', () => {
            mockSerializerR4B.patientSerializer = {
                readSerialize: jestObj.fn().mockImplementation((o) => ({ ...o, readSerialized: true }))
            };
            const arr = [
                { resourceType: 'Patient', id: '1' },
                { resourceType: 'Patient', id: '2' }
            ];

            const result = FhirResourceReadSerializer.serializeArray({ obj: arr });

            expect(result).toHaveLength(2);
            expect(result[0]).toEqual({ resourceType: 'Patient', id: '1', readSerialized: true });
            expect(result[1]).toEqual({ resourceType: 'Patient', id: '2', readSerialized: true });
        });

        test('filters out falsy values from array before serializing', () => {
            mockSerializerR4B.patientSerializer = {
                readSerialize: jestObj.fn().mockImplementation((o) => ({ ...o, done: true }))
            };
            const arr = [
                { resourceType: 'Patient', id: '1' },
                null,
                undefined,
                { resourceType: 'Patient', id: '2' }
            ];

            const result = FhirResourceReadSerializer.serializeArray({ obj: arr });

            expect(result).toHaveLength(2);
        });

        test('wraps single non-array object in array', () => {
            mockSerializerR4B.patientSerializer = {
                readSerialize: jestObj.fn().mockReturnValue({ wrapped: true })
            };
            const obj = { resourceType: 'Patient', id: '1' };

            const result = FhirResourceReadSerializer.serializeArray({ obj });

            expect(Array.isArray(result)).toBe(true);
            expect(result).toHaveLength(1);
            expect(result[0]).toEqual({ wrapped: true });
        });

        test('passes SerializerClass through to serialize for each item', () => {
            const SerializerClass = {
                readSerialize: jestObj.fn().mockReturnValue({ custom: true })
            };
            const arr = [
                { resourceType: 'Patient', id: '1' },
                { resourceType: 'Patient', id: '2' }
            ];

            const result = FhirResourceReadSerializer.serializeArray({ obj: arr, SerializerClass });

            expect(SerializerClass.readSerialize).toHaveBeenCalledTimes(2);
            expect(result[0]).toEqual({ custom: true });
            expect(result[1]).toEqual({ custom: true });
        });

        test('passes context through to serialize for each item', () => {
            mockSerializerR4B.patientSerializer = {
                readSerialize: jestObj.fn().mockReturnValue({})
            };
            const arr = [{ resourceType: 'Patient', id: '1' }];
            const context = { trace: 'xyz' };

            FhirResourceReadSerializer.serializeArray({ obj: arr, context });

            expect(mockSerializerR4B.patientSerializer.readSerialize).toHaveBeenCalledWith(
                { resourceType: 'Patient', id: '1' },
                { trace: 'xyz', resourceType: 'Patient' }
            );
        });

        test('throws RethrownError on serialization failure in array', () => {
            mockSerializerR4B.patientSerializer = {
                readSerialize: jestObj.fn().mockImplementation(() => { throw new Error('boom'); })
            };
            const arr = [{ resourceType: 'Patient', id: '1' }];

            try {
                FhirResourceReadSerializer.serializeArray({ obj: arr });
                throw new Error('should have thrown');
            } catch (e) {
                expect(e.message).toBe('Error in serializing resource');
                expect(e.source).toBe('FhirResourceReadSerializer.serializeArray');
            }
        });

        test('returns empty array when all elements are falsy', () => {
            const arr = [null, undefined, null];
            const result = FhirResourceReadSerializer.serializeArray({ obj: arr });
            expect(result).toEqual([]);
        });

        test('handles array with mixed resource types', () => {
            mockSerializerR4B.patientSerializer = {
                readSerialize: jestObj.fn().mockReturnValue({ type: 'patient' })
            };
            mockSerializerR4B.observationSerializer = {
                readSerialize: jestObj.fn().mockReturnValue({ type: 'obs' })
            };

            const arr = [
                { resourceType: 'Patient', id: '1' },
                { resourceType: 'Observation', id: '2' }
            ];

            const result = FhirResourceReadSerializer.serializeArray({ obj: arr });

            expect(result).toHaveLength(2);
            expect(result[0]).toEqual({ type: 'patient' });
            expect(result[1]).toEqual({ type: 'obs' });
        });
    });

    describe('serializePrimitiveArray', () => {
        test('returns null when obj is null', () => {
            const result = FhirResourceReadSerializer.serializePrimitiveArray({ obj: null });
            expect(result).toBeNull();
        });

        test('returns undefined when obj is undefined', () => {
            const result = FhirResourceReadSerializer.serializePrimitiveArray({ obj: undefined });
            expect(result).toBeUndefined();
        });

        test('filters falsy values from array', () => {
            const arr = ['hello', null, 'world', undefined, '', 0, false];
            const result = FhirResourceReadSerializer.serializePrimitiveArray({ obj: arr });
            expect(result).toEqual(['hello', 'world']);
        });

        test('wraps single value in array', () => {
            const result = FhirResourceReadSerializer.serializePrimitiveArray({ obj: 'single' });
            expect(result).toEqual(['single']);
        });

        test('wraps single number in array', () => {
            const result = FhirResourceReadSerializer.serializePrimitiveArray({ obj: 42 });
            expect(result).toEqual([42]);
        });

        test('preserves non-empty array with only truthy values', () => {
            const result = FhirResourceReadSerializer.serializePrimitiveArray({ obj: ['a', 'b', 'c'] });
            expect(result).toEqual(['a', 'b', 'c']);
        });

        test('returns empty array when all elements are falsy', () => {
            const result = FhirResourceReadSerializer.serializePrimitiveArray({ obj: [null, undefined, 0, '', false] });
            expect(result).toEqual([]);
        });
    });

    describe('inheritance from BaseFhirResourceSerializer', () => {
        test('FhirResourceReadSerializer is a function (class)', () => {
            expect(typeof FhirResourceReadSerializer).toBe('function');
        });

        test('calls readSerialize method (not serialize or writeSerialize)', () => {
            // Register a serializer that has multiple methods to verify the right one is called
            mockSerializerR4B.patientSerializer = {
                serialize: jestObj.fn().mockReturnValue({ method: 'serialize' }),
                readSerialize: jestObj.fn().mockReturnValue({ method: 'readSerialize' }),
                writeSerialize: jestObj.fn().mockReturnValue({ method: 'writeSerialize' })
            };
            const obj = { resourceType: 'Patient', id: '1' };

            const result = FhirResourceReadSerializer.serialize({ obj });

            expect(result).toEqual({ method: 'readSerialize' });
            expect(mockSerializerR4B.patientSerializer.readSerialize).toHaveBeenCalled();
            expect(mockSerializerR4B.patientSerializer.serialize).not.toHaveBeenCalled();
            expect(mockSerializerR4B.patientSerializer.writeSerialize).not.toHaveBeenCalled();
        });
    });
});
