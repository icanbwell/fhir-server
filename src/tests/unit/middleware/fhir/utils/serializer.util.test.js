'use strict';

const { describe, test, expect, jest: jestObj } = require('@jest/globals');

jestObj.mock('../../../../../fhir/serializers/4_0_0/resources', () => ({
    patient: { serialize: (obj) => ({ ...obj, serialized: true }) },
    observation: { serialize: (obj) => ({ ...obj, serialized: true }) }
}));

jestObj.mock('../../../../../fhir/serializers/4_0_0/complex_types', () => ({
    codeableconcept: { serialize: (obj) => ({ ...obj, complex: true }) }
}));

jestObj.mock('../../../../../fhir/serializers/4_0_0/custom_resources', () => ({
    exportstatus: { serialize: (obj) => ({ ...obj, custom: true }) }
}));

const { resolveSerialzier } = require('../../../../../middleware/fhir/utils/serializer.util');

describe('serializer.util', () => {
    test('resolves resource serializer for known resourceType', () => {
        const serializer = resolveSerialzier('4_0_0', 'Patient');
        expect(serializer).toBeDefined();
        expect(serializer.serialize).toBeDefined();
    });

    test('resolves complex type serializer', () => {
        const serializer = resolveSerialzier('4_0_0', 'CodeableConcept');
        expect(serializer).toBeDefined();
    });

    test('resolves custom resource serializer', () => {
        const serializer = resolveSerialzier('4_0_0', 'ExportStatus');
        expect(serializer).toBeDefined();
    });

    test('returns undefined for unknown schema', () => {
        const serializer = resolveSerialzier('4_0_0', 'NonExistent');
        expect(serializer).toBeUndefined();
    });

    test('lowercases schema name for lookup', () => {
        const serializer = resolveSerialzier('4_0_0', 'PATIENT');
        expect(serializer).toBeDefined();
    });

    test('defaults version to 4_0_0', () => {
        const serializer = resolveSerialzier(undefined, 'Patient');
        expect(serializer).toBeDefined();
    });

    test('returns undefined for unsupported version', () => {
        const serializer = resolveSerialzier('3_0_0', 'Patient');
        expect(serializer).toBeUndefined();
    });
});
