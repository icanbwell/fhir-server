'use strict';

const { describe, test, expect } = require('@jest/globals');
const {
    validatePatchDoesNotTargetInternalFields,
    findInternalFieldInPath,
    findInternalFieldInValue
} = require('../../../../../operations/patch/validators/patchInternalFieldsValidator');

describe('patchInternalFieldsValidator', () => {
    describe('findInternalFieldInPath', () => {
        test('returns null for paths without internal fields', () => {
            expect(findInternalFieldInPath('/name/0/family')).toBeNull();
            expect(findInternalFieldInPath('/meta/security')).toBeNull();
            expect(findInternalFieldInPath('/status')).toBeNull();
        });

        test('detects _ prefixed segments', () => {
            expect(findInternalFieldInPath('/_uuid')).toBe('_uuid');
            expect(findInternalFieldInPath('/link/0/_uuid')).toBe('_uuid');
            expect(findInternalFieldInPath('/_sourceId')).toBe('_sourceId');
            expect(findInternalFieldInPath('/_access/client-a')).toBe('_access');
        });

        test('returns the first internal field found', () => {
            expect(findInternalFieldInPath('/_uuid/_sourceId')).toBe('_uuid');
        });

        test('handles empty path', () => {
            expect(findInternalFieldInPath('')).toBeNull();
        });

        test('does NOT detect meta.security as internal (no _ prefix)', () => {
            expect(findInternalFieldInPath('/meta/security/0/code')).toBeNull();
        });
    });

    describe('findInternalFieldInValue', () => {
        test('returns null for primitives', () => {
            expect(findInternalFieldInValue('hello')).toBeNull();
            expect(findInternalFieldInValue(42)).toBeNull();
            expect(findInternalFieldInValue(true)).toBeNull();
            expect(findInternalFieldInValue(null)).toBeNull();
            expect(findInternalFieldInValue(undefined)).toBeNull();
        });

        test('detects internal fields in objects', () => {
            expect(findInternalFieldInValue({ _uuid: 'abc-123' })).toBe('_uuid');
            expect(findInternalFieldInValue({ reference: 'Patient/1', _sourceId: 'x' })).toBe('_sourceId');
        });

        test('detects internal fields in nested objects', () => {
            const value = {
                link: [{
                    target: {
                        reference: 'Patient/1',
                        _uuid: 'injected-uuid'
                    }
                }]
            };
            expect(findInternalFieldInValue(value)).toBe('_uuid');
        });

        test('detects internal fields in arrays', () => {
            const value = [
                { reference: 'Patient/1' },
                { _access: { 'client-a': 1 } }
            ];
            expect(findInternalFieldInValue(value)).toBe('_access');
        });

        test('returns null for clean objects', () => {
            const value = {
                reference: 'Patient/123',
                display: 'John Doe',
                type: 'Patient'
            };
            expect(findInternalFieldInValue(value)).toBeNull();
        });

        test('handles deeply nested structures', () => {
            const value = {
                a: { b: { c: { d: { _secret: 'value' } } } }
            };
            expect(findInternalFieldInValue(value)).toBe('_secret');
        });
    });

    describe('validatePatchDoesNotTargetInternalFields', () => {
        test('passes for standard FHIR patch operations', () => {
            const patches = [
                { op: 'replace', path: '/name/0/family', value: 'Smith' },
                { op: 'add', path: '/telecom/-', value: { system: 'phone', value: '555-1234' } },
                { op: 'remove', path: '/address/0' }
            ];
            expect(() => validatePatchDoesNotTargetInternalFields(patches)).not.toThrow();
        });

        test('throws for path targeting _uuid', () => {
            const patches = [
                { op: 'replace', path: '/_uuid', value: 'attacker-controlled-uuid' }
            ];
            expect(() => validatePatchDoesNotTargetInternalFields(patches)).toThrow(/internal field '_uuid'/);
        });

        test('throws for path targeting _access', () => {
            const patches = [
                { op: 'add', path: '/_access/attacker-tenant', value: 1 }
            ];
            expect(() => validatePatchDoesNotTargetInternalFields(patches)).toThrow(/internal field '_access'/);
        });

        test('throws for path targeting _sourceId', () => {
            const patches = [
                { op: 'replace', path: '/_sourceId', value: 'hijacked' }
            ];
            expect(() => validatePatchDoesNotTargetInternalFields(patches)).toThrow(/internal field '_sourceId'/);
        });

        test('throws for internal fields in value objects', () => {
            const patches = [
                { op: 'replace', path: '/link/0/target', value: { reference: 'Patient/1', _uuid: 'injected' } }
            ];
            expect(() => validatePatchDoesNotTargetInternalFields(patches)).toThrow(/internal field '_uuid' in value/);
        });

        test('throws for internal fields in move/copy from path', () => {
            const patches = [
                { op: 'move', from: '/_uuid', path: '/identifier/0/value' }
            ];
            expect(() => validatePatchDoesNotTargetInternalFields(patches)).toThrow(/internal field '_uuid' in 'from'/);
        });

        test('throws for copy from internal field', () => {
            const patches = [
                { op: 'copy', from: '/_sourceAssigningAuthority', path: '/identifier/0/value' }
            ];
            expect(() => validatePatchDoesNotTargetInternalFields(patches)).toThrow(/_sourceAssigningAuthority/);
        });

        test('does NOT throw for meta.security path (not _ prefixed)', () => {
            const patches = [
                { op: 'replace', path: '/meta/security/0/code', value: 'new-tenant' }
            ];
            expect(() => validatePatchDoesNotTargetInternalFields(patches)).not.toThrow();
        });

        test('handles non-array input gracefully', () => {
            expect(() => validatePatchDoesNotTargetInternalFields(null)).not.toThrow();
            expect(() => validatePatchDoesNotTargetInternalFields(undefined)).not.toThrow();
            expect(() => validatePatchDoesNotTargetInternalFields('string')).not.toThrow();
        });

        test('validates all operations in array (not just first)', () => {
            const patches = [
                { op: 'replace', path: '/name/0/family', value: 'Safe' },
                { op: 'replace', path: '/status', value: 'active' },
                { op: 'replace', path: '/_owner', value: 'hijacked' }
            ];
            expect(() => validatePatchDoesNotTargetInternalFields(patches)).toThrow(/internal field '_owner'/);
        });

        test('nested array values with internal fields detected', () => {
            const patches = [
                {
                    op: 'replace',
                    path: '/contained',
                    value: [
                        { resourceType: 'Patient', id: '1' },
                        { resourceType: 'Patient', id: '2', _access: { evil: 1 } }
                    ]
                }
            ];
            expect(() => validatePatchDoesNotTargetInternalFields(patches)).toThrow(/internal field '_access' in value/);
        });
    });
});
