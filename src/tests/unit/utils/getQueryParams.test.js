'use strict';

const { describe, test, expect } = require('@jest/globals');
const { getQueryParams } = require('../../../utils/getQueryParams');

describe('getQueryParams', () => {
    test('parses string query parameters', () => {
        const result = getQueryParams('http://example.com?name=John&status=active');
        expect(result.name).toBe('John');
        expect(result.status).toBe('active');
    });

    test('converts "true" string to boolean true', () => {
        const result = getQueryParams('http://example.com?_include=true');
        expect(result._include).toBe(true);
    });

    test('converts "false" string to boolean false', () => {
        const result = getQueryParams('http://example.com?_count=false');
        expect(result._count).toBe(false);
    });

    test('converts numeric strings to numbers', () => {
        const result = getQueryParams('http://example.com?_count=50&page=3');
        expect(result._count).toBe(50);
        expect(result.page).toBe(3);
    });

    test('handles decimal numbers', () => {
        const result = getQueryParams('http://example.com?score=3.14');
        expect(result.score).toBe(3.14);
    });

    test('returns empty object for URL without query string', () => {
        const result = getQueryParams('http://example.com/Patient');
        expect(result).toEqual({});
    });

    test('preserves non-numeric strings that start with numbers', () => {
        const result = getQueryParams('http://example.com?id=123abc');
        expect(result.id).toBe('123abc');
    });

    test('handles empty value', () => {
        const result = getQueryParams('http://example.com?key=');
        expect(result.key).toBe('');
    });

    test('handles URL-encoded values', () => {
        const result = getQueryParams('http://example.com?system=http%3A%2F%2Floinc.org');
        expect(result.system).toBe('http://loinc.org');
    });

    test('handles negative numbers', () => {
        const result = getQueryParams('http://example.com?offset=-10');
        expect(result.offset).toBe(-10);
    });
});
