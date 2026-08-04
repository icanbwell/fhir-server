'use strict';

const { describe, test, expect } = require('@jest/globals');
const hyphenToCamel = require('../../../../../middleware/fhir/utils/hyphen-to-camel.utils');

describe('hyphen-to-camel.utils', () => {
    test('converts "hello-world" to "helloWorld"', () => {
        expect(hyphenToCamel('hello-world')).toBe('helloWorld');
    });

    test('converts "a-b-c" to "aBC"', () => {
        expect(hyphenToCamel('a-b-c')).toBe('aBC');
    });

    test('returns string unchanged when no hyphens present', () => {
        expect(hyphenToCamel('nohyphens')).toBe('nohyphens');
    });

    test('handles empty string', () => {
        expect(hyphenToCamel('')).toBe('');
    });

    test('converts multiple hyphenated words', () => {
        expect(hyphenToCamel('one-two-three-four')).toBe('oneTwoThreeFour');
    });

    test('does not convert uppercase letters after hyphen', () => {
        // The regex only matches -[a-z], so -A stays as is
        expect(hyphenToCamel('hello-World')).toBe('hello-World');
    });

    test('handles single character segments', () => {
        expect(hyphenToCamel('x-y-z')).toBe('xYZ');
    });

    test('converts hyphenated FHIR-style names', () => {
        expect(hyphenToCamel('general-practitioner')).toBe('generalPractitioner');
        expect(hyphenToCamel('birth-date')).toBe('birthDate');
    });
});
