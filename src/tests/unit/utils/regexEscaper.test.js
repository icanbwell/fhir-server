'use strict';

const { describe, test, expect } = require('@jest/globals');
const { escapeRegExp } = require('../../../utils/regexEscaper');

describe('escapeRegExp', () => {
    test('escapes dot character', () => {
        expect(escapeRegExp('a.b')).toBe('a\\.b');
    });

    test('escapes asterisk', () => {
        expect(escapeRegExp('a*b')).toBe('a\\*b');
    });

    test('escapes plus', () => {
        expect(escapeRegExp('a+b')).toBe('a\\+b');
    });

    test('escapes question mark', () => {
        expect(escapeRegExp('a?b')).toBe('a\\?b');
    });

    test('escapes caret', () => {
        expect(escapeRegExp('^start')).toBe('\\^start');
    });

    test('escapes dollar sign', () => {
        expect(escapeRegExp('end$')).toBe('end\\$');
    });

    test('escapes curly braces', () => {
        expect(escapeRegExp('a{2,3}')).toBe('a\\{2,3\\}');
    });

    test('escapes parentheses', () => {
        expect(escapeRegExp('(group)')).toBe('\\(group\\)');
    });

    test('escapes pipe', () => {
        expect(escapeRegExp('a|b')).toBe('a\\|b');
    });

    test('escapes square brackets', () => {
        expect(escapeRegExp('[abc]')).toBe('\\[abc\\]');
    });

    test('escapes backslash', () => {
        expect(escapeRegExp('a\\b')).toBe('a\\\\b');
    });

    test('returns empty string unchanged', () => {
        expect(escapeRegExp('')).toBe('');
    });

    test('returns plain text unchanged', () => {
        expect(escapeRegExp('hello world')).toBe('hello world');
    });

    test('escaped string works safely in RegExp constructor', () => {
        const dangerous = 'user.name (test) [v2]';
        const escaped = escapeRegExp(dangerous);
        const regex = new RegExp(escaped);
        expect(regex.test(dangerous)).toBe(true);
        expect(regex.test('userXname')).toBe(false);
    });
});
