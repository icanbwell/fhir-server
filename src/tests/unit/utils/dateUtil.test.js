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

/**
 * Deepening pass (unit-test-master batch H2): DST/timezone boundaries and invalid-date edge
 * cases requested for this file, plus several OBSERVATIONS found while probing those edges. None
 * of these are filed as BUGH2 findings per RULE 17/18 (reachability): a repo-wide grep for
 * `validateDate` and `isUTCDayDifferent` (excluding this file and their own export lines) returns
 * ZERO production call sites for either -- both are dead code, only reachable from tests. (The
 * only other `validateDate`-like hit is the unrelated `_validateDateRange` method on
 * genericClickHouseQueryBuilder.js, a different function entirely.) `getLastUpdatedISO`'s only
 * real caller (src/operations/history/history.js) passes Mongo/BSON-sourced Date values, which
 * are not established to ever be an "Invalid Date" within this batch's scope. All three are
 * documented with passing tests that pin CURRENT behavior so a future change is visible in
 * review, per the "cannot confirm impact -> observation, not bug" rule.
 *
 * Note: `moment(...).format('...Z')` renders the UTC offset as "+00:00", not the letter "Z" --
 * confirmed empirically below and used throughout these expectations.
 */
describe('date.util edge cases (DST, invalid input, dead-code observations)', () => {
    describe('validateDate additional edge cases', () => {
        test('OBSERVATION: a digit-led unparseable date string does not throw -- it silently produces "Invalid date" under the normal $eq key (see the file-level TODO)', () => {
            // validateDate always returns a truthy object even for garbage input, exactly as the
            // module's own TODO comment warns ("validateDate will always return something
            // truthy... this could create a query that returns unexpected results"). Pinned here
            // as documented, known behavior rather than a new finding. Dead code (see describe
            // block doc comment above), so this is an observation, not a filed bug.
            const result = validateDate('0000-99-99');
            expect(result.$eq).toBe('Invalid date');
        });

        test('OBSERVATION: a two-letter alpha lead-in that is not a recognized prefix (ge/le/lt/gt) becomes a bogus Mongo operator key instead of $eq', () => {
            // The regex's first capture group `(^\D\D)?` greedily takes ANY two leading
            // non-digit characters as a "prefix" candidate, not just the four FHIR-recognized
            // ones. For 'not-a-real-date', match[1] is 'no' -- which isn't 'ge'/'le', so the
            // .replace() calls are no-ops and the code builds the key '$no' instead of falling
            // back to '$eq'. Combined with the TODO above, a value like this would put an
            // unrecognized operator key straight into a Mongo query object. Dead code (zero
            // production callers), so recorded as an observation only.
            const result = validateDate('not-a-real-date');
            expect(result.$eq).toBeUndefined();
            expect(result.$no).toBe('Invalid date');
        });

        test('restores a "+" offset that a URL parser stripped into a space (ge prefix, positive offset)', () => {
            // The regex's third capture group exists specifically for values like
            // "2023-06-15T10:00:00 05:00" (a URL-decoded "...+05:00" that lost its "+").
            const result = validateDate('ge2023-06-15T10:00:00 05:00');
            expect(result.$gte).toBe('2023-06-15T05:00:00+00:00');
        });

        test('parses a date at the US "spring forward" DST boundary correctly in UTC (no local-time shift)', () => {
            const result = validateDate('2024-03-10T07:00:00Z');
            expect(result.$eq).toBe('2024-03-10T07:00:00+00:00');
        });

        test('parses a date at the US "fall back" DST boundary correctly in UTC (no local-time shift)', () => {
            const result = validateDate('2024-11-03T06:00:00Z');
            expect(result.$eq).toBe('2024-11-03T06:00:00+00:00');
        });

        test('parses a leap-day date (2024-02-29) correctly', () => {
            const result = validateDate('2024-02-29');
            expect(result.$eq).toContain('2024-02-29');
        });
    });

    describe('isUTCDayDifferent boundary cases', () => {
        test('returns false for the exact same instant', () => {
            const instant = new Date('2024-06-15T12:00:00Z');
            expect(isUTCDayDifferent(instant, instant)).toBe(false);
        });

        test('returns true across an adjacent UTC midnight boundary', () => {
            const beforeMidnight = new Date('2024-06-15T23:59:59.999Z');
            const afterMidnight = new Date('2024-06-16T00:00:00.000Z');
            expect(isUTCDayDifferent(beforeMidnight, afterMidnight)).toBe(true);
        });

        test('OBSERVATION: two dates exactly 7 days apart (same weekday) are reported as NOT different -- getUTCDay() is day-of-week, not day-of-month', () => {
            // isUTCDayDifferent compares start.getUTCDay() !== end.getUTCDay(), i.e. weekday
            // (0-6), not calendar date. Two Mondays a week apart share a weekday and so are
            // incorrectly reported as "not different" despite being on entirely different
            // calendar dates. This looks like a getUTCDay()/getUTCDate() mix-up, but the function
            // has zero production callers (grep confirms only this file references it), so it is
            // recorded as an observation rather than filed as a bug per RULE 17 (no reachable
            // entry point to demonstrate real impact).
            const monday1 = new Date('2024-01-01T10:00:00Z');
            const monday2 = new Date('2024-01-08T10:00:00Z');
            expect(monday1.getUTCDay()).toBe(monday2.getUTCDay());
            expect(isUTCDayDifferent(monday1, monday2)).toBe(false);
        });
    });

    describe('getLastUpdatedISO additional edge cases', () => {
        test('returns the correct ISO string for a leap-day Date', () => {
            const leapDay = new Date('2024-02-29T12:00:00Z');
            expect(getLastUpdatedISO(leapDay)).toBe('2024-02-29T12:00:00.000Z');
        });

        test('returns the correct ISO string for a Date at exactly UTC midnight', () => {
            const midnight = new Date('2024-01-01T00:00:00.000Z');
            expect(getLastUpdatedISO(midnight)).toBe('2024-01-01T00:00:00.000Z');
        });

        test('OBSERVATION: an Invalid Date instance throws instead of falling back to defaultValue', () => {
            // `new Date('garbage')` IS `instanceof Date`, so the `instanceof Date` guard passes
            // and the function unconditionally calls `.toISOString()`, which throws RangeError
            // for an invalid time value rather than returning `defaultValue`. Not filed as a
            // BUGH2 finding: this file's only real caller (history.js) sources lastUpdated from
            // Mongo/BSON Date fields, and establishing that those can ever be an Invalid Date
            // instance is outside this batch's scope (RULE 17/18). Pinned here so a future
            // `Number.isNaN(date.getTime())` guard is a visible, deliberate change.
            const invalidDate = new Date('not-a-real-date');
            expect(invalidDate instanceof Date).toBe(true);
            expect(() => getLastUpdatedISO(invalidDate)).toThrow(RangeError);
        });
    });
});
