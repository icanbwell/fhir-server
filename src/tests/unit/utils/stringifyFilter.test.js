'use strict';

const { describe, test, expect } = require('@jest/globals');
const { stringifyFilter } = require('../../../utils/stringifyFilter');

describe('stringifyFilter', () => {
    test('converts RegExp to its string representation', () => {
        const regex = /abc/gi;
        const result = stringifyFilter('key', regex);
        expect(result).toBe('/abc/gi');
    });

    test('converts simple RegExp without flags', () => {
        const regex = /hello/;
        const result = stringifyFilter('key', regex);
        expect(result).toBe('/hello/');
    });

    test('passes through string values unchanged', () => {
        expect(stringifyFilter('key', 'hello')).toBe('hello');
    });

    test('passes through number values unchanged', () => {
        expect(stringifyFilter('key', 42)).toBe(42);
    });

    test('passes through null unchanged', () => {
        expect(stringifyFilter('key', null)).toBeNull();
    });

    test('passes through undefined unchanged', () => {
        expect(stringifyFilter('key', undefined)).toBeUndefined();
    });

    test('passes through object values unchanged', () => {
        const obj = { a: 1, b: 2 };
        expect(stringifyFilter('key', obj)).toBe(obj);
    });

    test('passes through array values unchanged', () => {
        const arr = [1, 2, 3];
        expect(stringifyFilter('key', arr)).toBe(arr);
    });

    test('passes through boolean values unchanged', () => {
        expect(stringifyFilter('key', true)).toBe(true);
        expect(stringifyFilter('key', false)).toBe(false);
    });

    test('passes through zero unchanged', () => {
        expect(stringifyFilter('key', 0)).toBe(0);
    });
});
