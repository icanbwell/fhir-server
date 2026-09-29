const { describe, test, expect } = require('@jest/globals');
const {
    rankPersonLinkAssurance,
    meetsMinimumAssurance,
    isRecognizedAssuranceLevel,
    DEFAULT_ASSURANCE_MINIMUM_LEVEL
} = require('../../../utils/personLinkAssuranceLevel');

describe('personLinkAssuranceLevel', () => {
    describe('rankPersonLinkAssurance', () => {
        test('returns 0 for missing (undefined) assurance', () => {
            expect(rankPersonLinkAssurance(undefined)).toBe(0);
        });

        test('returns 0 for null assurance', () => {
            expect(rankPersonLinkAssurance(null)).toBe(0);
        });

        test('returns 0 for empty-string assurance', () => {
            expect(rankPersonLinkAssurance('')).toBe(0);
        });

        test('returns 0 for an unrecognized assurance value', () => {
            expect(rankPersonLinkAssurance('not-a-real-level')).toBe(0);
        });

        test('ranks level1 as 1', () => {
            expect(rankPersonLinkAssurance('level1')).toBe(1);
        });

        test('ranks level2 as 2', () => {
            expect(rankPersonLinkAssurance('level2')).toBe(2);
        });

        test('ranks level3 as 3', () => {
            expect(rankPersonLinkAssurance('level3')).toBe(3);
        });

        test('ranks level4 as 4', () => {
            expect(rankPersonLinkAssurance('level4')).toBe(4);
        });
    });

    describe('meetsMinimumAssurance', () => {
        test('returns true when assurance equals the minimum', () => {
            expect(meetsMinimumAssurance({ assurance: 'level2', minimumLevel: 'level2' })).toBe(true);
        });

        test('returns true when assurance is above the minimum', () => {
            expect(meetsMinimumAssurance({ assurance: 'level4', minimumLevel: 'level2' })).toBe(true);
        });

        test('returns false when assurance is below the minimum', () => {
            expect(meetsMinimumAssurance({ assurance: 'level1', minimumLevel: 'level2' })).toBe(false);
        });

        test('returns false when assurance is missing (ranks 0, fails any configured minimum)', () => {
            expect(meetsMinimumAssurance({ assurance: undefined, minimumLevel: 'level2' })).toBe(false);
        });

        test('returns false when assurance is an unrecognized value', () => {
            expect(meetsMinimumAssurance({ assurance: 'bogus', minimumLevel: 'level2' })).toBe(false);
        });

        test('returns true at the lowest minimum (level1) when assurance is exactly level1', () => {
            expect(meetsMinimumAssurance({ assurance: 'level1', minimumLevel: 'level1' })).toBe(true);
        });
    });

    describe('isRecognizedAssuranceLevel', () => {
        test.each(['level1', 'level2', 'level3', 'level4'])('returns true for %s', (level) => {
            expect(isRecognizedAssuranceLevel(level)).toBe(true);
        });

        test('returns false for an unrecognized string', () => {
            expect(isRecognizedAssuranceLevel('level0')).toBe(false);
        });

        test('returns false for a case-mismatched value', () => {
            expect(isRecognizedAssuranceLevel('Level2')).toBe(false);
        });

        test('returns false for undefined/null/empty', () => {
            expect(isRecognizedAssuranceLevel(undefined)).toBe(false);
            expect(isRecognizedAssuranceLevel(null)).toBe(false);
            expect(isRecognizedAssuranceLevel('')).toBe(false);
        });
    });

    describe('DEFAULT_ASSURANCE_MINIMUM_LEVEL', () => {
        test('is itself a recognized level', () => {
            expect(isRecognizedAssuranceLevel(DEFAULT_ASSURANCE_MINIMUM_LEVEL)).toBe(true);
        });
    });
});
