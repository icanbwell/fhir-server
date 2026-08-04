'use strict';

const { describe, test, expect } = require('@jest/globals');
const { QueryParameterValue } = require('../../../../operations/query/queryParameterValue');

describe('QueryParameterValue', () => {
    describe('constructor', () => {
        test('stores simple string value', () => {
            const qpv = new QueryParameterValue({ value: 'Patient/123' });
            expect(qpv.value).toBe('Patient/123');
        });

        test('defaults operator to $and', () => {
            const qpv = new QueryParameterValue({ value: 'abc' });
            expect(qpv.operator).toBe('$and');
        });

        test('sets operator to $or when value contains comma', () => {
            const qpv = new QueryParameterValue({ value: 'Patient/1,Patient/2' });
            expect(qpv.operator).toBe('$or');
        });

        test('filters falsy values from array input', () => {
            const qpv = new QueryParameterValue({ value: ['a', '', null, 'b', undefined] });
            expect(qpv.value).toEqual(['a', 'b']);
        });

        test('throws for invalid operator', () => {
            expect(() => new QueryParameterValue({ value: 'x', operator: '$nor' })).toThrow();
        });

        test('accepts $or as explicit operator', () => {
            const qpv = new QueryParameterValue({ value: 'single', operator: '$or' });
            expect(qpv.operator).toBe('$or');
        });

        test('comma in value overrides $and default to $or', () => {
            const qpv = new QueryParameterValue({ value: 'a,b', operator: '$and' });
            expect(qpv.operator).toBe('$or');
        });
    });

    describe('values getter', () => {
        test('splits comma-separated string into array', () => {
            const qpv = new QueryParameterValue({ value: 'Patient/1,Patient/2,Patient/3' });
            expect(qpv.values).toEqual(['Patient/1', 'Patient/2', 'Patient/3']);
        });

        test('wraps single value in array', () => {
            const qpv = new QueryParameterValue({ value: 'Patient/123' });
            expect(qpv.values).toEqual(['Patient/123']);
        });

        test('returns null for empty string', () => {
            const qpv = new QueryParameterValue({ value: '' });
            expect(qpv.values).toBeNull();
        });

        test('returns null for null value', () => {
            const qpv = new QueryParameterValue({ value: null });
            expect(qpv.values).toBeNull();
        });

        test('returns array input as-is', () => {
            const qpv = new QueryParameterValue({ value: ['a', 'b'] });
            expect(qpv.values).toEqual(['a', 'b']);
        });

        test('does not split single value without comma', () => {
            const qpv = new QueryParameterValue({ value: 'no-comma-here' });
            expect(qpv.values).toEqual(['no-comma-here']);
        });
    });

    describe('regenerateValueFromValues', () => {
        test('joins array with commas', () => {
            const qpv = new QueryParameterValue({ value: 'x' });
            expect(qpv.regenerateValueFromValues(['a', 'b', 'c'])).toBe('a,b,c');
        });

        test('returns null/undefined as-is for non-array', () => {
            const qpv = new QueryParameterValue({ value: 'x' });
            expect(qpv.regenerateValueFromValues(null)).toBeNull();
            expect(qpv.regenerateValueFromValues(undefined)).toBeUndefined();
        });

        test('returns empty string for empty array', () => {
            const qpv = new QueryParameterValue({ value: 'x' });
            expect(qpv.regenerateValueFromValues([])).toBe('');
        });
    });

    describe('clone', () => {
        test('creates independent copy', () => {
            const original = new QueryParameterValue({ value: 'Patient/1,Patient/2' });
            const cloned = original.clone();
            expect(cloned.value).toBe(original.value);
            expect(cloned.operator).toBe(original.operator);
            expect(cloned).not.toBe(original);
        });

        test('mutation of clone does not affect original', () => {
            const original = new QueryParameterValue({ value: 'test' });
            const cloned = original.clone();
            cloned.value = 'modified';
            expect(original.value).toBe('test');
        });
    });

    describe('toJSON', () => {
        test('includes value, values, and operator', () => {
            const qpv = new QueryParameterValue({ value: 'a,b' });
            const json = qpv.toJSON();
            expect(json.value).toBe('a,b');
            expect(json.values).toEqual(['a', 'b']);
            expect(json.operator).toBe('$or');
        });

        test('strips null values from output', () => {
            const qpv = new QueryParameterValue({ value: null });
            const json = qpv.toJSON();
            expect(json.value).toBeUndefined();
            expect(json.values).toBeUndefined();
        });
    });
});
