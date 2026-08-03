const { describe, test, expect, beforeEach, jest: jestObj } = require('@jest/globals');

// Mock dependencies
const mockSerializerMethod = jestObj.fn();
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

const { BaseFhirResourceSerializer } = require('../../../fhir/baseFhirResourceSerializer');

describe('BaseFhirResourceSerializer', () => {
    let TestSerializer;

    beforeEach(() => {
        mockSerializerMethod.mockReset();

        // Clean mock serializer registries
        Object.keys(mockSerializerR4B).forEach((k) => delete mockSerializerR4B[k]);
        Object.keys(mockSerializerComplexTypeR4B).forEach((k) => delete mockSerializerComplexTypeR4B[k]);
        Object.keys(mockSerializersCustom).forEach((k) => delete mockSerializersCustom[k]);

        // Create a test subclass with a concrete serializerMethod
        TestSerializer = class extends BaseFhirResourceSerializer {};
        TestSerializer.serializerMethod = 'serialize';
    });

    describe('serialize', () => {
        test('returns null/undefined when obj is falsy', () => {
            expect(TestSerializer.serialize({ obj: null })).toBeNull();
            expect(TestSerializer.serialize({ obj: undefined })).toBeUndefined();
        });

        test('uses provided SerializerClass when given', () => {
            const mockClass = { serialize: jestObj.fn().mockReturnValue({ id: '1', serialized: true }) };
            const obj = { resourceType: 'Patient', id: '1' };

            const result = TestSerializer.serialize({ obj, SerializerClass: mockClass });

            expect(mockClass.serialize).toHaveBeenCalledWith(obj, { resourceType: 'Patient' });
            expect(result).toEqual({ id: '1', serialized: true });
        });

        test('passes context with resourceType to SerializerClass', () => {
            const mockClass = { serialize: jestObj.fn().mockReturnValue({}) };
            const obj = { resourceType: 'Observation', id: '2' };
            const context = { requestId: 'req-123' };

            TestSerializer.serialize({ obj, SerializerClass: mockClass, context });

            expect(mockClass.serialize).toHaveBeenCalledWith(obj, {
                requestId: 'req-123',
                resourceType: 'Observation'
            });
        });

        test('does not add resourceType to context for SerializerClass when obj has no resourceType', () => {
            const mockClass = { serialize: jestObj.fn().mockReturnValue({}) };
            const obj = { id: '3' }; // no resourceType
            const context = { requestId: 'req-456' };

            TestSerializer.serialize({ obj, SerializerClass: mockClass, context });

            expect(mockClass.serialize).toHaveBeenCalledWith(obj, { requestId: 'req-456' });
        });

        test('throws RethrownError when obj has no resourceType and no SerializerClass', () => {
            const obj = { id: '4' }; // no resourceType

            expect(() => TestSerializer.serialize({ obj })).toThrow('Error in serializing resource');
        });

        test('inner error is BadRequestError when resourceType is null', () => {
            const obj = { id: '5' };

            try {
                TestSerializer.serialize({ obj });
                throw new Error('should have thrown');
            } catch (e) {
                expect(e.innerError.message).toBe('resourceType is null');
                expect(e.innerError.statusCode).toBe(400);
            }
        });

        test('looks up serializer from resources registry', () => {
            mockSerializerR4B.patientSerializer = { serialize: jestObj.fn().mockReturnValue({ done: true }) };
            const obj = { resourceType: 'Patient', id: '6' };

            const result = TestSerializer.serialize({ obj });

            expect(mockSerializerR4B.patientSerializer.serialize).toHaveBeenCalledWith(obj, { resourceType: 'Patient' });
            expect(result).toEqual({ done: true });
        });

        test('looks up serializer from complexTypes registry if not in resources', () => {
            mockSerializerComplexTypeR4B.addressSerializer = { serialize: jestObj.fn().mockReturnValue({ complex: true }) };
            const obj = { resourceType: 'Address', id: '7' };

            const result = TestSerializer.serialize({ obj });

            expect(result).toEqual({ complex: true });
        });

        test('looks up serializer from custom registry if not in resources or complexTypes', () => {
            mockSerializersCustom.customTypeSerializer = { serialize: jestObj.fn().mockReturnValue({ custom: true }) };
            const obj = { resourceType: 'CustomType', id: '8' };

            const result = TestSerializer.serialize({ obj });

            expect(result).toEqual({ custom: true });
        });

        test('throws RethrownError for unsupported resourceType', () => {
            const obj = { resourceType: 'UnsupportedType', id: '9' };

            try {
                TestSerializer.serialize({ obj });
                throw new Error('should have thrown');
            } catch (e) {
                expect(e.message).toBe('Error in serializing resource');
                expect(e.innerError.message).toBe('ResourceType UnsupportedType is not supported');
            }
        });

        test('includes resource in error args when serializer throws', () => {
            mockSerializerR4B.patientSerializer = {
                serialize: jestObj.fn().mockImplementation(() => { throw new Error('serialize failed'); })
            };
            const obj = { resourceType: 'Patient', id: '10' };

            try {
                TestSerializer.serialize({ obj });
                throw new Error('should have thrown');
            } catch (e) {
                expect(e.args.resource).toBe(obj);
            }
        });

        test('serializer name schema lookup lowercases first char', () => {
            // 'Patient' -> 'patientSerializer'
            mockSerializerR4B.patientSerializer = { serialize: jestObj.fn().mockReturnValue({}) };
            TestSerializer.serialize({ obj: { resourceType: 'Patient' } });
            expect(mockSerializerR4B.patientSerializer.serialize).toHaveBeenCalled();
        });
    });

    describe('serializeByResourceType', () => {
        test('returns null/undefined when obj is falsy', () => {
            expect(TestSerializer.serializeByResourceType({ obj: null, resourceType: 'Patient' })).toBeNull();
            expect(TestSerializer.serializeByResourceType({ obj: undefined, resourceType: 'Patient' })).toBeUndefined();
        });

        test('serializes using specified resourceType regardless of obj.resourceType', () => {
            mockSerializerR4B.observationSerializer = { serialize: jestObj.fn().mockReturnValue({ typed: true }) };
            const obj = { resourceType: 'Patient', id: '11' };

            const result = TestSerializer.serializeByResourceType({ obj, resourceType: 'Observation' });

            expect(mockSerializerR4B.observationSerializer.serialize).toHaveBeenCalledWith(obj, { resourceType: 'Observation' });
            expect(result).toEqual({ typed: true });
        });

        test('passes context with resourceType', () => {
            mockSerializerR4B.patientSerializer = { serialize: jestObj.fn().mockReturnValue({}) };
            const context = { user: 'admin' };

            TestSerializer.serializeByResourceType({
                obj: { id: '12' },
                resourceType: 'Patient',
                context
            });

            expect(mockSerializerR4B.patientSerializer.serialize).toHaveBeenCalledWith(
                { id: '12' },
                { user: 'admin', resourceType: 'Patient' }
            );
        });

        test('throws RethrownError when serializer not found', () => {
            try {
                TestSerializer.serializeByResourceType({ obj: { id: '13' }, resourceType: 'UnknownType' });
                throw new Error('should have thrown');
            } catch (e) {
                expect(e.message).toBe('Error in serializing resource');
                // source uses this.name which is the subclass name
                expect(e.source).toContain('.serializeByResourceType');
            }
        });
    });

    describe('serializeArray', () => {
        test('returns null/undefined when obj is falsy', () => {
            expect(TestSerializer.serializeArray({ obj: null })).toBeNull();
            expect(TestSerializer.serializeArray({ obj: undefined })).toBeUndefined();
        });

        test('serializes each item in an array', () => {
            mockSerializerR4B.patientSerializer = {
                serialize: jestObj.fn().mockImplementation((o) => ({ ...o, serialized: true }))
            };
            const arr = [
                { resourceType: 'Patient', id: '1' },
                { resourceType: 'Patient', id: '2' }
            ];

            const result = TestSerializer.serializeArray({ obj: arr });

            expect(result).toHaveLength(2);
            expect(result[0]).toEqual({ resourceType: 'Patient', id: '1', serialized: true });
            expect(result[1]).toEqual({ resourceType: 'Patient', id: '2', serialized: true });
        });

        test('filters out falsy values from array before serializing', () => {
            mockSerializerR4B.patientSerializer = {
                serialize: jestObj.fn().mockImplementation((o) => ({ ...o, done: true }))
            };
            const arr = [
                { resourceType: 'Patient', id: '1' },
                null,
                undefined,
                { resourceType: 'Patient', id: '2' }
            ];

            const result = TestSerializer.serializeArray({ obj: arr });

            expect(result).toHaveLength(2);
        });

        test('wraps single object in array', () => {
            mockSerializerR4B.patientSerializer = {
                serialize: jestObj.fn().mockReturnValue({ wrapped: true })
            };
            const obj = { resourceType: 'Patient', id: '1' };

            const result = TestSerializer.serializeArray({ obj });

            expect(Array.isArray(result)).toBe(true);
            expect(result).toHaveLength(1);
            expect(result[0]).toEqual({ wrapped: true });
        });

        test('passes SerializerClass through to serialize', () => {
            const mockClass = { serialize: jestObj.fn().mockReturnValue({ custom: true }) };
            const arr = [{ resourceType: 'Patient', id: '1' }];

            const result = TestSerializer.serializeArray({ obj: arr, SerializerClass: mockClass });

            expect(mockClass.serialize).toHaveBeenCalled();
            expect(result[0]).toEqual({ custom: true });
        });

        test('throws RethrownError on serialization failure in array', () => {
            mockSerializerR4B.patientSerializer = {
                serialize: jestObj.fn().mockImplementation(() => { throw new Error('boom'); })
            };
            const arr = [{ resourceType: 'Patient', id: '1' }];

            expect(() => TestSerializer.serializeArray({ obj: arr })).toThrow('Error in serializing resource');
        });
    });

    describe('serializePrimitiveArray', () => {
        test('returns null/undefined when obj is falsy', () => {
            expect(TestSerializer.serializePrimitiveArray({ obj: null })).toBeNull();
            expect(TestSerializer.serializePrimitiveArray({ obj: undefined })).toBeUndefined();
        });

        test('filters out falsy values from array', () => {
            const arr = ['hello', null, 'world', undefined, '', 0, false];
            const result = TestSerializer.serializePrimitiveArray({ obj: arr });

            // Only truthy values remain
            expect(result).toEqual(['hello', 'world']);
        });

        test('wraps single value in array', () => {
            const result = TestSerializer.serializePrimitiveArray({ obj: 'single-value' });

            expect(result).toEqual(['single-value']);
        });

        test('wraps number in array', () => {
            const result = TestSerializer.serializePrimitiveArray({ obj: 42 });

            expect(result).toEqual([42]);
        });

        test('preserves non-empty array as-is', () => {
            const arr = ['a', 'b', 'c'];
            const result = TestSerializer.serializePrimitiveArray({ obj: arr });

            expect(result).toEqual(['a', 'b', 'c']);
        });

        test('returns empty array when all elements are falsy', () => {
            const arr = [null, undefined, 0, '', false];
            const result = TestSerializer.serializePrimitiveArray({ obj: arr });

            expect(result).toEqual([]);
        });
    });

    describe('serializerMethod inheritance', () => {
        test('base class has null serializerMethod', () => {
            expect(BaseFhirResourceSerializer.serializerMethod).toBeNull();
        });

        test('subclass can override serializerMethod', () => {
            class WriteSerializer extends BaseFhirResourceSerializer {}
            WriteSerializer.serializerMethod = 'write';

            mockSerializerR4B.patientSerializer = { write: jestObj.fn().mockReturnValue({ written: true }) };

            const result = WriteSerializer.serialize({ obj: { resourceType: 'Patient' } });
            expect(result).toEqual({ written: true });
            expect(mockSerializerR4B.patientSerializer.write).toHaveBeenCalled();
        });
    });
});
