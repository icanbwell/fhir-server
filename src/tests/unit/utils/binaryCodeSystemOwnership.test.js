'use strict';

const { describe, test, expect } = require('@jest/globals');
const {
    CODE_SYSTEM_OWNER,
    isBinaryReadableViaCodeSystem,
    markCodeSystemProperties,
    removePatientScopes
} = require('../../../utils/binaryCodeSystemOwnership');

const codeSystem = { id: 'cs-1', _uuid: 'uuid-cs-1', _sourceId: 'cs-1' };

describe('isBinaryReadableViaCodeSystem', () => {
    test('true when the Binary has no securityContext', () => {
        expect(isBinaryReadableViaCodeSystem({ binary: { resourceType: 'Binary' }, codeSystem })).toBe(true);
    });

    test('true when securityContext is an empty object', () => {
        expect(isBinaryReadableViaCodeSystem({
            binary: { resourceType: 'Binary', securityContext: {} }, codeSystem
        })).toBe(true);
    });

    test('true when securityContext is exactly this CodeSystem (by id)', () => {
        expect(isBinaryReadableViaCodeSystem({
            binary: { securityContext: { reference: 'CodeSystem/cs-1' } }, codeSystem
        })).toBe(true);
    });

    test('true when securityContext is this CodeSystem by _uuid or with a source authority', () => {
        expect(isBinaryReadableViaCodeSystem({
            binary: { securityContext: { reference: 'CodeSystem/cs-1|client', _uuid: 'CodeSystem/uuid-cs-1' } },
            codeSystem
        })).toBe(true);
    });

    test('false when securityContext is a different CodeSystem', () => {
        expect(isBinaryReadableViaCodeSystem({
            binary: { securityContext: { reference: 'CodeSystem/cs-2' } }, codeSystem
        })).toBe(false);
    });

    test('false when securityContext is a Patient', () => {
        expect(isBinaryReadableViaCodeSystem({
            binary: { securityContext: { reference: 'Patient/cs-1' } }, codeSystem
        })).toBe(false);
    });

    test('false when any of the reference forms points elsewhere', () => {
        expect(isBinaryReadableViaCodeSystem({
            binary: { securityContext: { reference: 'CodeSystem/cs-1', _uuid: 'Patient/p1' } }, codeSystem
        })).toBe(false);
    });

    test('false when there is no Binary', () => {
        expect(isBinaryReadableViaCodeSystem({ binary: null, codeSystem })).toBe(false);
    });
});

describe('removePatientScopes', () => {
    test('drops patient scopes and keeps the rest', () => {
        expect(removePatientScopes('patient/*.* user/*.read access/*.*')).toBe('user/*.read access/*.*');
    });

    test('drops patient scopes case-insensitively', () => {
        expect(removePatientScopes('Patient/Binary.read user/*.read')).toBe('user/*.read');
    });

    test('returns an empty string for a pure patient scope or no scope', () => {
        expect(removePatientScopes('patient/*.*')).toBe('');
        expect(removePatientScopes(undefined)).toBe('');
    });
});

describe('markCodeSystemProperties', () => {
    test('marks properties at every concept depth without making the mark enumerable', () => {
        const nested = { code: 'child', property: [{ code: 'p', valueString: 'Binary/2' }] };
        const concepts = [
            { code: 'top', property: [{ code: 'p', valueString: 'Binary/1' }], concept: [nested] },
            { code: 'no-properties' }
        ];
        const result = markCodeSystemProperties(concepts, codeSystem);

        expect(result).toBe(concepts);
        expect(concepts[0].property[0][CODE_SYSTEM_OWNER]).toStrictEqual({
            id: 'cs-1', _uuid: 'uuid-cs-1', _sourceId: 'cs-1'
        });
        expect(nested.property[0][CODE_SYSTEM_OWNER].id).toBe('cs-1');
        expect(Object.keys(concepts[0].property[0])).toStrictEqual(['code', 'valueString']);
        expect(JSON.stringify(concepts[0].property[0])).not.toContain('cs-1');
    });

    test('returns non-array input unchanged', () => {
        expect(markCodeSystemProperties(undefined, codeSystem)).toBeUndefined();
    });
});
