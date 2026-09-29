'use strict';

const { describe, test, expect } = require('@jest/globals');
const { isFalse, isFalseWithFallback } = require('../../../utils/isFalse');

describe('isFalse', () => {
    test('returns true for boolean false', () => {
        expect(isFalse(false)).toBe(true);
    });

    test('returns true for string "false"', () => {
        expect(isFalse('false')).toBe(true);
    });

    test('returns true for string "FALSE" (case-insensitive)', () => {
        expect(isFalse('FALSE')).toBe(true);
    });

    test('returns true for string "0"', () => {
        expect(isFalse('0')).toBe(true);
    });

    test('returns false for boolean true', () => {
        expect(isFalse(true)).toBe(false);
    });

    test('returns false for string "true"', () => {
        expect(isFalse('true')).toBe(false);
    });

    test('returns false for string "1"', () => {
        expect(isFalse('1')).toBe(false);
    });

    test('returns false for empty string', () => {
        expect(isFalse('')).toBe(false);
    });

    test('returns false for null (String(null) = "null")', () => {
        expect(isFalse(null)).toBe(false);
    });
});

describe('isFalseWithFallback', () => {
    test('returns fallback when value is null', () => {
        expect(isFalseWithFallback(null, true)).toBe(true);
        expect(isFalseWithFallback(null, false)).toBe(false);
    });

    test('returns fallback when value is undefined', () => {
        expect(isFalseWithFallback(undefined, true)).toBe(true);
    });

    test('evaluates value when not null/undefined', () => {
        expect(isFalseWithFallback('false', true)).toBe(true);
        expect(isFalseWithFallback('true', true)).toBe(false);
    });

    test('does not use fallback for empty string', () => {
        expect(isFalseWithFallback('', true)).toBe(false);
    });
});
