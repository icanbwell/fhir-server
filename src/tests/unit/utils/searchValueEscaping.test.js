const { describe, test, expect } = require('@jest/globals');
const { splitUnescaped, unescapeSearchValue, hasNoRealTokenValue } = require('../../../utils/searchValueEscaping');

describe('searchValueEscaping', () => {
    describe('splitUnescaped', () => {
        test('splits on an unescaped delimiter', () => {
            expect(splitUnescaped('a,b', ',')).toEqual(['a', 'b']);
        });

        test('does not split on an escaped delimiter', () => {
            expect(splitUnescaped('a\\,b', ',')).toEqual(['a\\,b']);
        });

        test('splits on a real delimiter after an escaped one', () => {
            expect(splitUnescaped('a\\,b,c', ',')).toEqual(['a\\,b', 'c']);
        });

        test('treats an even run of backslashes before the delimiter as not escaping it', () => {
            expect(splitUnescaped('a\\\\,b', ',')).toEqual(['a\\\\', 'b']);
        });

        test('treats an odd run of backslashes before the delimiter as escaping it', () => {
            expect(splitUnescaped('a\\\\\\,b', ',')).toEqual(['a\\\\\\,b']);
        });

        test('only splits on the given delimiter, leaving other separator characters alone', () => {
            expect(splitUnescaped('a|b,c', ',')).toEqual(['a|b', 'c']);
        });

        test('returns the original single-element array when there is no delimiter', () => {
            expect(splitUnescaped('abc', ',')).toEqual(['abc']);
        });

        test('returns [value] unchanged for non-string input', () => {
            expect(splitUnescaped(undefined, ',')).toEqual([undefined]);
        });

        test('handles an empty string', () => {
            expect(splitUnescaped('', ',')).toEqual(['']);
        });
    });

    describe('unescapeSearchValue', () => {
        test('unescapes an escaped comma', () => {
            expect(unescapeSearchValue('a\\,b')).toBe('a,b');
        });

        test('unescapes an escaped pipe', () => {
            expect(unescapeSearchValue('a\\|b')).toBe('a|b');
        });

        test('unescapes an escaped dollar sign', () => {
            expect(unescapeSearchValue('a\\$b')).toBe('a$b');
        });

        test('unescapes an escaped backslash', () => {
            expect(unescapeSearchValue('a\\\\b')).toBe('a\\b');
        });

        test('collapses two consecutive escaped backslashes to two literal backslashes', () => {
            expect(unescapeSearchValue('a\\\\\\\\b')).toBe('a\\\\b');
        });

        test('passes a trailing lone backslash through literally', () => {
            expect(unescapeSearchValue('abc\\')).toBe('abc\\');
        });

        test('passes a backslash followed by a non-escapable character through literally', () => {
            expect(unescapeSearchValue('a\\nb')).toBe('a\\nb');
        });

        test('returns non-string input unchanged', () => {
            expect(unescapeSearchValue(undefined)).toBe(undefined);
        });

        test('handles an empty string', () => {
            expect(unescapeSearchValue('')).toBe('');
        });
    });

    describe('hasNoRealTokenValue', () => {
        test('is true for a completely empty string', () => {
            expect(hasNoRealTokenValue('')).toBe(true);
        });

        test('is true for undefined/null', () => {
            expect(hasNoRealTokenValue(undefined)).toBe(true);
            expect(hasNoRealTokenValue(null)).toBe(true);
        });

        test('is true for "system|" -- a system with nothing after the pipe', () => {
            expect(hasNoRealTokenValue('http://example.com/mrn|')).toBe(true);
        });

        test('is false for "system|value"', () => {
            expect(hasNoRealTokenValue('http://example.com/mrn|123456')).toBe(false);
        });

        test('is false for a plain value with no pipe at all', () => {
            expect(hasNoRealTokenValue('123456')).toBe(false);
        });

        test('is false for "|code" -- empty system, real code', () => {
            expect(hasNoRealTokenValue('|123456')).toBe(false);
        });

        test('is false when the trailing pipe is escaped (literal value ending in a pipe character)', () => {
            expect(hasNoRealTokenValue('123456\\|')).toBe(false);
        });
    });
});
