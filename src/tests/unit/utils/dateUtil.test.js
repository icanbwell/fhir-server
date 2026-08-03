'use strict';

const { describe, test, expect } = require('@jest/globals');
const { validateDate, isUTCDayDifferent, getLastUpdatedISO } = require('../../../utils/date.util');

describe('date.util', () => {
    describe('validateDate', () => {
        test('parses single date without prefix as $eq', () => {
            const result = validateDate('2023-01-15');
            expect(result.$eq).toBeDefined();
            expect(result.$eq).toContain('2023-01-15');
        });

        test('parses ge prefix as $gte', () => {
            const result = validateDate('ge2023-06-01');
            expect(result.$gte).toBeDefined();
            expect(result.$gte).toContain('2023-06-01');
        });

        test('parses le prefix as $lte', () => {
            const result = validateDate('le2023-12-31');
            expect(result.$lte).toBeDefined();
            expect(result.$lte).toContain('2023-12-31');
        });

        test('parses gt prefix as $gt', () => {
            const result = validateDate('gt2023-03-01');
            expect(result.$gt).toBeDefined();
        });

        test('parses lt prefix as $lt', () => {
            const result = validateDate('lt2023-09-15');
            expect(result.$lt).toBeDefined();
        });

        test('handles comma-delimited date range (ge and le)', () => {
            const result = validateDate('ge2023-01-01,le2023-12-31');
            expect(result.$gte).toBeDefined();
            expect(result.$lte).toBeDefined();
        });

        test('returns empty object for null/undefined input', () => {
            expect(validateDate(null)).toEqual({});
            expect(validateDate(undefined)).toEqual({});
        });

        test('handles ISO datetime with timezone', () => {
            const result = validateDate('2023-06-15T10:30:00+05:00');
            expect(result.$eq).toBeDefined();
        });
    });

    describe('isUTCDayDifferent', () => {
        test('returns false for same UTC day', () => {
            const start = new Date('2023-06-15T10:00:00Z');
            const end = new Date('2023-06-15T23:59:59Z');
            expect(isUTCDayDifferent(start, end)).toBe(false);
        });

        test('returns true for different UTC days', () => {
            const start = new Date('2023-06-15T10:00:00Z');
            const end = new Date('2023-06-16T10:00:00Z');
            expect(isUTCDayDifferent(start, end)).toBe(true);
        });
    });

    describe('getLastUpdatedISO', () => {
        test('returns ISO string for Date object', () => {
            const date = new Date('2023-06-15T10:00:00Z');
            expect(getLastUpdatedISO(date)).toBe('2023-06-15T10:00:00.000Z');
        });

        test('returns defaultValue for non-Date input', () => {
            expect(getLastUpdatedISO('not-a-date')).toBeNull();
        });

        test('returns custom defaultValue when provided', () => {
            expect(getLastUpdatedISO(null, 'fallback')).toBe('fallback');
        });

        test('returns null for falsy input without custom default', () => {
            expect(getLastUpdatedISO(null)).toBeNull();
            expect(getLastUpdatedISO(undefined)).toBeNull();
            expect(getLastUpdatedISO('')).toBeNull();
        });
    });
});
