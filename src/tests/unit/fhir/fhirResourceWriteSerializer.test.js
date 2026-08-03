'use strict';

const { describe, test, expect, jest: jestObj } = require('@jest/globals');

jestObj.mock('../../../middleware/fhir/utils/constants', () => ({
    VERSIONS: { '4_0_0': '4_0_0' }
}));

jestObj.mock('../../../fhir/writeSerializers/4_0_0/resources', () => ({
    patientSerializer: {
        writeSerialize: (obj) => ({ ...obj, _serialized: true }),
        writeNormalize: (obj) => ({ id: obj.id, resourceType: obj.resourceType })
    }
}));

jestObj.mock('../../../fhir/writeSerializers/4_0_0/complexTypes', () => ({}));
jestObj.mock('../../../fhir/writeSerializers/4_0_0/customSerializers', () => ({}));

const { FhirResourceWriteSerializer } = require('../../../fhir/fhirResourceWriteSerializer');
const { FhirResourceWriteNormalizeSerializer } = require('../../../fhir/fhirResourceWriteNormalizeSerializer');

describe('FhirResourceWriteSerializer', () => {
    test('serializerMethod is writeSerialize', () => {
        expect(FhirResourceWriteSerializer.serializerMethod).toBe('writeSerialize');
    });

    test('serialize returns null for falsy input', () => {
        expect(FhirResourceWriteSerializer.serialize({ obj: null })).toBeNull();
        expect(FhirResourceWriteSerializer.serialize({ obj: undefined })).toBeUndefined();
    });

    test('serialize uses registry serializer for known resourceType', () => {
        const result = FhirResourceWriteSerializer.serialize({
            obj: { resourceType: 'Patient', id: '123' }
        });
        expect(result._serialized).toBe(true);
    });

    test('serialize throws for missing resourceType', () => {
        expect(() => FhirResourceWriteSerializer.serialize({
            obj: { id: '123' }
        })).toThrow();
    });

    test('serialize uses custom SerializerClass when provided', () => {
        const CustomSerializer = {
            writeSerialize: (obj) => ({ custom: true, id: obj.id })
        };
        const result = FhirResourceWriteSerializer.serialize({
            obj: { resourceType: 'Patient', id: 'p1' },
            SerializerClass: CustomSerializer
        });
        expect(result.custom).toBe(true);
    });

    describe('serializeArray', () => {
        test('returns null for falsy input', () => {
            expect(FhirResourceWriteSerializer.serializeArray({ obj: null })).toBeNull();
        });

        test('serializes an array of resources', () => {
            const result = FhirResourceWriteSerializer.serializeArray({
                obj: [
                    { resourceType: 'Patient', id: '1' },
                    { resourceType: 'Patient', id: '2' }
                ]
            });
            expect(result).toHaveLength(2);
            expect(result[0]._serialized).toBe(true);
        });

        test('wraps single object in array', () => {
            const result = FhirResourceWriteSerializer.serializeArray({
                obj: { resourceType: 'Patient', id: '1' }
            });
            expect(result).toHaveLength(1);
        });

        test('filters out falsy results', () => {
            const CustomSerializer = {
                writeSerialize: (obj) => obj.id === 'skip' ? null : obj
            };
            const result = FhirResourceWriteSerializer.serializeArray({
                obj: [{ id: 'keep', resourceType: 'X' }, { id: 'skip', resourceType: 'X' }],
                SerializerClass: CustomSerializer
            });
            expect(result).toHaveLength(1);
        });

        test('returns null when all results are filtered', () => {
            const CustomSerializer = {
                writeSerialize: () => null
            };
            const result = FhirResourceWriteSerializer.serializeArray({
                obj: [{ resourceType: 'X' }],
                SerializerClass: CustomSerializer
            });
            expect(result).toBeNull();
        });
    });
});

describe('FhirResourceWriteNormalizeSerializer', () => {
    test('serializerMethod is writeNormalize', () => {
        expect(FhirResourceWriteNormalizeSerializer.serializerMethod).toBe('writeNormalize');
    });

    test('serialize uses writeNormalize on registry serializer', () => {
        const result = FhirResourceWriteNormalizeSerializer.serialize({
            obj: { resourceType: 'Patient', id: '123', extraField: 'removed' }
        });
        expect(result.id).toBe('123');
        expect(result.extraField).toBeUndefined();
    });
});
