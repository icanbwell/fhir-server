'use strict';

const { describe, test, expect, jest: jestObj } = require('@jest/globals');

jestObj.mock('../../../../../fhir/classes/4_0_0/resources', () => ({
    patient: class Patient { constructor(data) { Object.assign(this, data); } },
    observation: class Observation { constructor(data) { Object.assign(this, data); } }
}));

jestObj.mock('../../../../../fhir/classes/4_0_0/complex_types', () => ({
    codeableconcept: class CodeableConcept { constructor(data) { Object.assign(this, data); } }
}));

jestObj.mock('../../../../../fhir/classes/4_0_0/custom_resources', () => ({
    exportstatus: class ExportStatus { constructor(data) { Object.assign(this, data); } }
}));

jestObj.mock('../../../../../middleware/fhir/utils/constants', () => ({
    VERSIONS: { '4_0_0': '4_0_0' }
}));

const { resolveSchema, isValidVersion } = require('../../../../../middleware/fhir/utils/schema.utils');

describe('schema.utils', () => {
    describe('resolveSchema', () => {
        test('resolves resource schema for known type', () => {
            const Schema = resolveSchema('4_0_0', 'Patient');
            expect(Schema).toBeDefined();
            const instance = new Schema({ id: '123' });
            expect(instance.id).toBe('123');
        });

        test('resolves complex type schema', () => {
            const Schema = resolveSchema('4_0_0', 'CodeableConcept');
            expect(Schema).toBeDefined();
        });

        test('resolves custom resource schema', () => {
            const Schema = resolveSchema('4_0_0', 'ExportStatus');
            expect(Schema).toBeDefined();
        });

        test('returns undefined for unknown schema', () => {
            const Schema = resolveSchema('4_0_0', 'NonExistent');
            expect(Schema).toBeUndefined();
        });

        test('case-insensitive lookup', () => {
            const Schema = resolveSchema('4_0_0', 'PATIENT');
            expect(Schema).toBeDefined();
        });

        test('defaults version to 4_0_0', () => {
            const Schema = resolveSchema(undefined, 'Patient');
            expect(Schema).toBeDefined();
        });

        test('returns undefined for unsupported version', () => {
            const Schema = resolveSchema('3_0_0', 'Patient');
            expect(Schema).toBeUndefined();
        });
    });

    describe('isValidVersion', () => {
        test('returns true for valid version', () => {
            expect(isValidVersion('4_0_0')).toBe(true);
        });

        test('returns false for invalid version', () => {
            expect(isValidVersion('9_9_9')).toBe(false);
        });

        test('returns false for undefined', () => {
            expect(isValidVersion(undefined)).toBe(false);
        });
    });
});
