const { describe, test, expect } = require('@jest/globals');
const {
    isV1Suffix,
    isV2Suffix,
    normalizeSuffixToCruds,
    parseScopeToken,
    isActionSatisfiedByCruds
} = require('../../../../operations/security/smartScopeParser');

describe('smartScopeParser', () => {
    describe('isV1Suffix', () => {
        test.each(['read', 'write', '*'])('%s is a v1 suffix', (suffix) => {
            expect(isV1Suffix(suffix)).toBe(true);
        });

        test.each(['r', 'rs', 'cruds', '', 'bogus'])('%s is not a v1 suffix', (suffix) => {
            expect(isV1Suffix(suffix)).toBe(false);
        });
    });

    describe('isV2Suffix', () => {
        test.each(['r', 'rs', 'cruds', 'c', 'cud'])('%s is a valid v2 suffix', (suffix) => {
            expect(isV2Suffix(suffix)).toBe(true);
        });

        test('empty suffix is not v2', () => {
            expect(isV2Suffix('')).toBe(false);
        });

        test('duplicate letters are not v2', () => {
            expect(isV2Suffix('rr')).toBe(false);
        });

        test('unknown letters are not v2', () => {
            expect(isV2Suffix('rx')).toBe(false);
        });

        test.each(['read', 'write', '*'])('v1 suffix %s is not also v2', (suffix) => {
            expect(isV2Suffix(suffix)).toBe(false);
        });
    });

    describe('normalizeSuffixToCruds', () => {
        test('read normalizes to {r, s}', () => {
            expect(normalizeSuffixToCruds('read')).toEqual(new Set(['r', 's']));
        });

        test('write normalizes to {c, u, d}', () => {
            expect(normalizeSuffixToCruds('write')).toEqual(new Set(['c', 'u', 'd']));
        });

        test('* normalizes to {c, r, u, d, s}', () => {
            expect(normalizeSuffixToCruds('*')).toEqual(new Set(['c', 'r', 'u', 'd', 's']));
        });

        test('v2 suffix normalizes to its own letters', () => {
            expect(normalizeSuffixToCruds('rs')).toEqual(new Set(['r', 's']));
        });

        test('malformed suffix normalizes to null', () => {
            expect(normalizeSuffixToCruds('rr')).toBeNull();
            expect(normalizeSuffixToCruds('bogus')).toBeNull();
            expect(normalizeSuffixToCruds('')).toBeNull();
        });
    });

    describe('parseScopeToken', () => {
        test('parses a v1 patient/ scope', () => {
            expect(parseScopeToken('patient/Patient.read')).toEqual({
                prefix: 'patient',
                resourceType: 'Patient',
                cruds: new Set(['r', 's'])
            });
        });

        test('parses a v2 user/ scope', () => {
            expect(parseScopeToken('user/*.cruds')).toEqual({
                prefix: 'user',
                resourceType: '*',
                cruds: new Set(['c', 'r', 'u', 'd', 's'])
            });
        });

        test('parses a v2 access/ scope', () => {
            expect(parseScopeToken('access/tenantA.rs')).toEqual({
                prefix: 'access',
                resourceType: 'tenantA',
                cruds: new Set(['r', 's'])
            });
        });

        test('parses a v2 system/ scope', () => {
            expect(parseScopeToken('system/Observation.rs')).toEqual({
                prefix: 'system',
                resourceType: 'Observation',
                cruds: new Set(['r', 's'])
            });
        });

        test('returns null for an unknown prefix', () => {
            expect(parseScopeToken('admin/Patient.read')).toBeNull();
        });

        test('returns null with no slash', () => {
            expect(parseScopeToken('bogus')).toBeNull();
        });

        test('returns null with no dot', () => {
            expect(parseScopeToken('user/Patient')).toBeNull();
        });

        test('returns null for empty resourceType', () => {
            expect(parseScopeToken('user/.read')).toBeNull();
        });

        test('returns null for a malformed suffix', () => {
            expect(parseScopeToken('user/Patient.bogus')).toBeNull();
        });

        test('returns null for falsy input', () => {
            expect(parseScopeToken('')).toBeNull();
            expect(parseScopeToken(null)).toBeNull();
            expect(parseScopeToken(undefined)).toBeNull();
        });
    });

    describe('isActionSatisfiedByCruds', () => {
        test('read action is satisfied by r', () => {
            expect(isActionSatisfiedByCruds(new Set(['r', 's']), 'read')).toBe(true);
        });

        test('read action is not satisfied by write-only cruds', () => {
            expect(isActionSatisfiedByCruds(new Set(['c', 'u', 'd']), 'read')).toBe(false);
        });

        test('write action is satisfied by any of c/u/d', () => {
            expect(isActionSatisfiedByCruds(new Set(['c']), 'write')).toBe(true);
            expect(isActionSatisfiedByCruds(new Set(['u']), 'write')).toBe(true);
            expect(isActionSatisfiedByCruds(new Set(['d']), 'write')).toBe(true);
        });

        test('write action is not satisfied by read-only cruds', () => {
            expect(isActionSatisfiedByCruds(new Set(['r', 's']), 'write')).toBe(false);
        });

        test('the full cruds set satisfies both read and write', () => {
            const full = new Set(['c', 'r', 'u', 'd', 's']);
            expect(isActionSatisfiedByCruds(full, 'read')).toBe(true);
            expect(isActionSatisfiedByCruds(full, 'write')).toBe(true);
        });

        test('returns false for a null cruds set', () => {
            expect(isActionSatisfiedByCruds(null, 'read')).toBe(false);
        });

        test('returns false for an unknown action', () => {
            expect(isActionSatisfiedByCruds(new Set(['r']), 'bogus')).toBe(false);
        });
    });
});
