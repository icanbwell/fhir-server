const { describe, test, expect } = require('@jest/globals');
const { isSafeRelativeUrl } = require('../../../oauth/redirect');

describe('#oauth redirect.js isSafeRelativeUrl (DCON-4804 open-redirect fix)', () => {
    test('accepts a plain relative path', () => {
        expect(isSafeRelativeUrl('/dashboard')).toBe(true);
        expect(isSafeRelativeUrl('/Patient/123')).toBe(true);
    });

    test('rejects protocol-relative URLs (the original bypass)', () => {
        expect(isSafeRelativeUrl('//evil.com')).toBe(false);
        expect(isSafeRelativeUrl('//evil.com/phish')).toBe(false);
    });

    test('rejects backslash-based protocol-relative bypasses (browsers normalize \\ to /)', () => {
        expect(isSafeRelativeUrl('/\\evil.com')).toBe(false);
        expect(isSafeRelativeUrl('\\\\evil.com')).toBe(false);
        expect(isSafeRelativeUrl('/\\/evil.com')).toBe(false);
    });

    test('rejects tab/newline/CR-hidden protocol-relative bypasses (browsers strip these before navigating)', () => {
        expect(isSafeRelativeUrl('/\t/evil.com')).toBe(false);
        expect(isSafeRelativeUrl('/\n/evil.com')).toBe(false);
        expect(isSafeRelativeUrl('/\t\\evil.com')).toBe(false);
    });

    test('rejects absolute URLs with a scheme', () => {
        expect(isSafeRelativeUrl('https://evil.com')).toBe(false);
        expect(isSafeRelativeUrl('javascript:alert(1)')).toBe(false);
    });

    test('rejects non-relative and non-string values', () => {
        expect(isSafeRelativeUrl('evil.com')).toBe(false);
        expect(isSafeRelativeUrl('')).toBe(false);
        expect(isSafeRelativeUrl(null)).toBe(false);
        expect(isSafeRelativeUrl(undefined)).toBe(false);
    });
});
