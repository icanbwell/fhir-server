'use strict';

const { describe, test, expect } = require('@jest/globals');
const hyphenToCamel = require('../../../middleware/fhir/utils/hyphen-to-camel.utils');

describe('hyphen-to-camel.utils', () => {
    test('converts hyphenated string to camelCase', () => {
        expect(hyphenToCamel('content-type')).toBe('contentType');
    });

    test('converts multiple hyphens', () => {
        expect(hyphenToCamel('x-forwarded-for')).toBe('xForwardedFor');
    });

    test('leaves non-hyphenated string unchanged', () => {
        expect(hyphenToCamel('hello')).toBe('hello');
    });

    test('handles empty string', () => {
        expect(hyphenToCamel('')).toBe('');
    });

    test('handles single character after hyphen', () => {
        expect(hyphenToCamel('a-b-c')).toBe('aBC');
    });

    test('does not convert uppercase letters after hyphen (only lowercase matches)', () => {
        expect(hyphenToCamel('x-Request-ID')).toBe('x-Request-ID');
    });

    test('handles trailing hyphen (no letter follows)', () => {
        expect(hyphenToCamel('test-')).toBe('test-');
    });
});
