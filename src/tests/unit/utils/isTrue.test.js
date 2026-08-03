'use strict';

const { describe, test, expect } = require('@jest/globals');
const { isTrue, isTrueWithFallback } = require('../../../utils/isTrue');
const { isFalse, isFalseWithFallback } = require('../../../utils/isFalse');

describe('isTrue', () => {
    test('returns true for boolean true', () => {
        expect(isTrue(true)).toBe(true);
    });

    test('returns true for string "true"', () => {
        expect(isTrue('true')).toBe(true);
    });

    test('returns true for string "TRUE"', () => {
        expect(isTrue('TRUE')).toBe(true);
    });

    test('returns true for string "True"', () => {
        expect(isTrue('True')).toBe(true);
    });

    test('returns true for string "1"', () => {
        expect(isTrue('1')).toBe(true);
    });

    test('returns true for number 1', () => {
        expect(isTrue(1)).toBe(true);
    });

    test('returns false for boolean false', () => {
        expect(isTrue(false)).toBe(false);
    });

    test('returns false for string "false"', () => {
        expect(isTrue('false')).toBe(false);
    });

    test('returns false for string "0"', () => {
        expect(isTrue('0')).toBe(false);
    });

    test('returns false for null', () => {
        expect(isTrue(null)).toBe(false);
    });

    test('returns false for undefined', () => {
        expect(isTrue(undefined)).toBe(false);
    });

    test('returns false for empty string', () => {
        expect(isTrue('')).toBe(false);
    });

    test('returns false for random string', () => {
        expect(isTrue('yes')).toBe(false);
    });
});

describe('isTrueWithFallback', () => {
    test('uses isTrue when value is defined', () => {
        expect(isTrueWithFallback('true', false)).toBe(true);
    });

    test('returns fallback when value is null', () => {
        expect(isTrueWithFallback(null, true)).toBe(true);
        expect(isTrueWithFallback(null, false)).toBe(false);
    });

    test('returns fallback when value is undefined', () => {
        expect(isTrueWithFallback(undefined, true)).toBe(true);
        expect(isTrueWithFallback(undefined, false)).toBe(false);
    });

    test('does NOT use fallback for empty string (falsy but defined)', () => {
        expect(isTrueWithFallback('', true)).toBe(false);
    });

    test('does NOT use fallback for "false" string', () => {
        expect(isTrueWithFallback('false', true)).toBe(false);
    });
});

describe('isFalse', () => {
    test('returns true for boolean false', () => {
        expect(isFalse(false)).toBe(true);
    });

    test('returns true for string "false"', () => {
        expect(isFalse('false')).toBe(true);
    });

    test('returns true for string "FALSE"', () => {
        expect(isFalse('FALSE')).toBe(true);
    });

    test('returns true for string "0"', () => {
        expect(isFalse('0')).toBe(true);
    });

    test('returns true for number 0', () => {
        expect(isFalse(0)).toBe(true);
    });

    test('returns false for boolean true', () => {
        expect(isFalse(true)).toBe(false);
    });

    test('returns false for string "true"', () => {
        expect(isFalse('true')).toBe(false);
    });

    test('returns false for null', () => {
        expect(isFalse(null)).toBe(false);
    });

    test('returns false for undefined', () => {
        expect(isFalse(undefined)).toBe(false);
    });

    test('returns false for empty string', () => {
        expect(isFalse('')).toBe(false);
    });
});

describe('isFalseWithFallback', () => {
    test('uses isFalse when value is defined', () => {
        expect(isFalseWithFallback('false', false)).toBe(true);
    });

    test('returns fallback when value is null', () => {
        expect(isFalseWithFallback(null, true)).toBe(true);
        expect(isFalseWithFallback(null, false)).toBe(false);
    });

    test('returns fallback when value is undefined', () => {
        expect(isFalseWithFallback(undefined, true)).toBe(true);
    });

    test('does NOT use fallback for empty string', () => {
        expect(isFalseWithFallback('', true)).toBe(false);
    });
});
