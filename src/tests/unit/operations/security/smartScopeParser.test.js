const { describe, test, expect } = require('@jest/globals');
const {
    isV1Suffix,
    isV2Suffix,
    normalizeSuffixToCruds,
    parseScopeToken,
    getRequiredCrudsForAccessRequested,
    isCrudsRequirementSatisfied,
    isReadOnlyAccessRequested,
    getInteractionCrudsLetter,
    INTERACTION_TO_CRUDS_LETTER
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

        // Feature-flag gating (soft rollout): callers pass their own ConfigManager-backed flag
        // as allowV2, off by default at the call sites.
        test('a v2 suffix normalizes to null when allowV2 is false', () => {
            expect(normalizeSuffixToCruds('rs', false)).toBeNull();
            expect(normalizeSuffixToCruds('c', false)).toBeNull();
        });

        test('v1 suffixes are unaffected by allowV2', () => {
            expect(normalizeSuffixToCruds('read', false)).toEqual(new Set(['r', 's']));
            expect(normalizeSuffixToCruds('write', false)).toEqual(new Set(['c', 'u', 'd']));
            expect(normalizeSuffixToCruds('*', false)).toEqual(new Set(['c', 'r', 'u', 'd', 's']));
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

        test('returns null for a v2 suffix when allowV2 is false', () => {
            expect(parseScopeToken('user/*.cruds', false)).toBeNull();
            expect(parseScopeToken('access/tenantA.rs', false)).toBeNull();
        });

        test('a v1 scope still parses when allowV2 is false', () => {
            expect(parseScopeToken('patient/Patient.read', false)).toEqual({
                prefix: 'patient',
                resourceType: 'Patient',
                cruds: new Set(['r', 's'])
            });
        });
    });


    describe('getRequiredCrudsForAccessRequested', () => {
        test('read normalizes to {r}', () => {
            expect(getRequiredCrudsForAccessRequested('read')).toEqual(new Set(['r']));
        });

        test('write normalizes to {c, u, d}', () => {
            expect(getRequiredCrudsForAccessRequested('write')).toEqual(new Set(['c', 'u', 'd']));
        });

        test.each(['c', 'r', 'u', 'd', 's'])('a bare CRUDS letter %s normalizes to {%s}', (letter) => {
            expect(getRequiredCrudsForAccessRequested(letter)).toEqual(new Set([letter]));
        });

        test('an unrecognized value returns null', () => {
            expect(getRequiredCrudsForAccessRequested('bogus')).toBeNull();
            expect(getRequiredCrudsForAccessRequested(undefined)).toBeNull();
        });
    });

    describe('isCrudsRequirementSatisfied', () => {
        test('returns true when a singleton requirement letter is present', () => {
            expect(isCrudsRequirementSatisfied(new Set(['r', 's']), new Set(['r']))).toBe(true);
            expect(isCrudsRequirementSatisfied(new Set(['c', 'u', 'd']), new Set(['u']))).toBe(true);
        });

        test('returns false when a singleton requirement letter is absent', () => {
            expect(isCrudsRequirementSatisfied(new Set(['r', 's']), new Set(['c', 'u', 'd']))).toBe(false);
        });

        // Regression for a reported finding: requiredCruds is a composite ({c, u, d} for the
        // legacy 'write' fallback) and must be satisfied in FULL, not by any single letter.
        // Holding only 'c' (create) must not satisfy a requirement that also asks for 'u'/'d' --
        // otherwise a create-only v2 grant would pass a write-composite check meant to gate an
        // update/delete-capable operation (e.g. merge, or $graph's delete branch), both of which
        // fall back to the coarse 'write' literal because their action name isn't in
        // INTERACTION_TO_CRUDS_LETTER.
        test('does NOT satisfy a composite requirement when only one of its letters is present', () => {
            expect(isCrudsRequirementSatisfied(new Set(['c']), new Set(['c', 'u', 'd']))).toBe(false);
            expect(isCrudsRequirementSatisfied(new Set(['u']), new Set(['c', 'u', 'd']))).toBe(false);
            expect(isCrudsRequirementSatisfied(new Set(['d']), new Set(['c', 'u', 'd']))).toBe(false);
        });

        test('does NOT satisfy a composite requirement when only two of its three letters are present', () => {
            expect(isCrudsRequirementSatisfied(new Set(['c', 'u']), new Set(['c', 'u', 'd']))).toBe(false);
        });

        test('satisfies a composite requirement only once every one of its letters is present', () => {
            expect(isCrudsRequirementSatisfied(new Set(['c', 'u', 'd']), new Set(['c', 'u', 'd']))).toBe(true);
            // a superset (e.g. the full cruds set, or extra unrelated letters) still satisfies it
            expect(isCrudsRequirementSatisfied(new Set(['c', 'r', 'u', 'd', 's']), new Set(['c', 'u', 'd']))).toBe(true);
        });

        test('returns false when no required letter is present', () => {
            expect(isCrudsRequirementSatisfied(new Set(['r', 's']), new Set(['c', 'u', 'd']))).toBe(false);
        });

        test('returns false for a null cruds set, a null requirement, or an empty requirement', () => {
            expect(isCrudsRequirementSatisfied(null, new Set(['r']))).toBe(false);
            expect(isCrudsRequirementSatisfied(new Set(['r']), null)).toBe(false);
            expect(isCrudsRequirementSatisfied(new Set(['r']), new Set())).toBe(false);
        });
    });

    describe('isReadOnlyAccessRequested', () => {
        test('the legacy read action is read-only', () => {
            expect(isReadOnlyAccessRequested('read')).toBe(true);
        });

        test('the legacy write action is not read-only', () => {
            expect(isReadOnlyAccessRequested('write')).toBe(false);
        });

        test.each(['r', 's'])('the bare letter %s is read-only', (letter) => {
            expect(isReadOnlyAccessRequested(letter)).toBe(true);
        });

        test.each(['c', 'u', 'd'])('the bare letter %s is not read-only', (letter) => {
            expect(isReadOnlyAccessRequested(letter)).toBe(false);
        });

        test('an unrecognized value is not read-only', () => {
            expect(isReadOnlyAccessRequested('bogus')).toBe(false);
        });
    });

    describe('getInteractionCrudsLetter', () => {
        test.each(Object.entries(INTERACTION_TO_CRUDS_LETTER))(
            '%s maps to %s', (interaction, letter) => {
                expect(getInteractionCrudsLetter(interaction)).toBe(letter);
            }
        );

        test('an interaction not in the table returns null (caller falls back to accessRequested)', () => {
            expect(getInteractionCrudsLetter('graph')).toBeNull();
            expect(getInteractionCrudsLetter('merge')).toBeNull();
            expect(getInteractionCrudsLetter(undefined)).toBeNull();
        });
    });
});
