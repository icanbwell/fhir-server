'use strict';

/**
 * Adversarial open-redirect coverage for src/oauth/redirect.js `isSafeRelativeUrl`.
 *
 * This is the only validation standing between the `resourceUrl` query parameter of the OAuth
 * auth-callback page and `window.location.assign(...)`. The page is a static asset, so
 * `resourceUrl` is fully attacker-controlled: anything this predicate returns `true` for is a
 * destination the browser will navigate a freshly-authenticated user to, with the `jwt` cookie
 * already written.
 *
 * Complements src/tests/unit/oauth/redirect.test.js (DCON-4804) with the browser-normalization
 * vectors it does not cover. Every case below is asserted against the WHATWG URL parsing rules the
 * browser applies before navigating:
 *   - tab (U+0009), LF (U+000A) and CR (U+000D) are stripped wherever they appear
 *   - leading/trailing C0 control characters and spaces are stripped from the whole input
 *   - for http(s) URLs, '\' is a path separator equivalent to '/'
 *
 * Oracle reference: bwell-business-logic-master.md §67 "Fail-Open vs Fail-Closed Classification"
 * — an input the validator cannot confidently prove is same-origin MUST be rejected (fail closed).
 */

const { describe, test, expect } = require('@jest/globals');
const { isSafeRelativeUrl } = require('../../../oauth/redirect');

describe('#oauth redirect.js isSafeRelativeUrl — adversarial normalization matrix', () => {
    describe('accepts genuine same-origin relative paths', () => {
        test('accepts a bare root, nested paths, and paths carrying query strings and fragments', () => {
            expect(isSafeRelativeUrl('/')).toBe(true);
            expect(isSafeRelativeUrl('/4_0_0/Patient')).toBe(true);
            expect(isSafeRelativeUrl('/4_0_0/Patient?_id=abc&_debug=1')).toBe(true);
            expect(isSafeRelativeUrl('/4_0_0/Patient#section')).toBe(true);
        });

        test('accepts a path whose first segment merely looks like a host or a userinfo separator', () => {
            // '/@evil.com' and '/evil.com' both resolve against the current origin, so they are safe.
            expect(isSafeRelativeUrl('/@evil.com')).toBe(true);
            expect(isSafeRelativeUrl('/evil.com')).toBe(true);
            expect(isSafeRelativeUrl('/https://evil.com')).toBe(true);
        });

        test('accepts a single backslash prefix, which the browser normalizes to a same-origin "/" path', () => {
            expect(isSafeRelativeUrl('\\dashboard')).toBe(true);
        });

        test('accepts paths containing already percent-encoded separators (the URL parser does not decode them before parsing)', () => {
            expect(isSafeRelativeUrl('/%2F%2Fevil.com')).toBe(true);
            expect(isSafeRelativeUrl('/%09/evil.com')).toBe(true);
        });

        test('accepts a leading tab/CR/LF followed by a single slash (the browser strips the control char, leaving a relative path)', () => {
            expect(isSafeRelativeUrl('\t/dashboard')).toBe(true);
            expect(isSafeRelativeUrl('\n/dashboard')).toBe(true);
            expect(isSafeRelativeUrl('\r/dashboard')).toBe(true);
        });
    });

    describe('SECURITY (§67 fail-closed): rejects every off-origin destination', () => {
        test('rejects protocol-relative URLs in plain, triple-slash and mixed-separator forms', () => {
            expect(isSafeRelativeUrl('//evil.com')).toBe(false);
            expect(isSafeRelativeUrl('///evil.com')).toBe(false);
            expect(isSafeRelativeUrl('//evil.com/callback?steal=1')).toBe(false);
            expect(isSafeRelativeUrl('/\\evil.com')).toBe(false);
            expect(isSafeRelativeUrl('\\/evil.com')).toBe(false);
            expect(isSafeRelativeUrl('\\\\evil.com')).toBe(false);
        });

        test('rejects tab/LF/CR-obfuscated protocol-relative URLs the browser strips before navigating', () => {
            expect(isSafeRelativeUrl('/\t/evil.com')).toBe(false);
            expect(isSafeRelativeUrl('/\n/evil.com')).toBe(false);
            expect(isSafeRelativeUrl('/\r/evil.com')).toBe(false);
            expect(isSafeRelativeUrl('\t//evil.com')).toBe(false);
            expect(isSafeRelativeUrl('/\t\\evil.com')).toBe(false);
            expect(isSafeRelativeUrl('/\r\n\t/evil.com')).toBe(false);
            expect(isSafeRelativeUrl('/\t/\t/evil.com')).toBe(false);
        });

        test('rejects absolute URLs for every scheme, including the dangerous script-bearing ones', () => {
            expect(isSafeRelativeUrl('https://evil.com')).toBe(false);
            expect(isSafeRelativeUrl('http://evil.com')).toBe(false);
            expect(isSafeRelativeUrl('HTTPS://EVIL.COM')).toBe(false);
            expect(isSafeRelativeUrl('javascript:alert(document.cookie)')).toBe(false);
            expect(isSafeRelativeUrl('JaVaScRiPt:alert(1)')).toBe(false);
            expect(isSafeRelativeUrl('data:text/html,<script>1</script>')).toBe(false);
            expect(isSafeRelativeUrl('vbscript:msgbox(1)')).toBe(false);
            expect(isSafeRelativeUrl('file:///etc/passwd')).toBe(false);
        });

        test('rejects a scheme split by a tab/newline, which the browser rejoins into "javascript:"', () => {
            expect(isSafeRelativeUrl('java\tscript:alert(1)')).toBe(false);
            expect(isSafeRelativeUrl('java\nscript:alert(1)')).toBe(false);
        });

        test('rejects host-relative values with no leading separator at all', () => {
            expect(isSafeRelativeUrl('evil.com')).toBe(false);
            expect(isSafeRelativeUrl('evil.com/path')).toBe(false);
            expect(isSafeRelativeUrl('./evil.com')).toBe(false);
            expect(isSafeRelativeUrl('../evil.com')).toBe(false);
        });

        test('rejects values whose leading character is a space or NUL that the browser would strip to expose "//"', () => {
            expect(isSafeRelativeUrl(' //evil.com')).toBe(false);
            expect(isSafeRelativeUrl('  //evil.com')).toBe(false);
            expect(isSafeRelativeUrl('\u0000//evil.com')).toBe(false);
            expect(isSafeRelativeUrl('\u0001//evil.com')).toBe(false);
            expect(isSafeRelativeUrl('\u000B//evil.com')).toBe(false);
            expect(isSafeRelativeUrl('\u000C//evil.com')).toBe(false);
        });

        test('rejects the empty string and every non-string input rather than coercing it', () => {
            expect(isSafeRelativeUrl('')).toBe(false);
            expect(isSafeRelativeUrl(null)).toBe(false);
            expect(isSafeRelativeUrl(undefined)).toBe(false);
            expect(isSafeRelativeUrl(0)).toBe(false);
            expect(isSafeRelativeUrl(['/safe'])).toBe(false);
            expect(isSafeRelativeUrl({ toString: () => '/safe' })).toBe(false);
            expect(isSafeRelativeUrl(new String('/safe'))).toBe(false); // eslint-disable-line no-new-wrappers
        });

        test('rejects the literal string "null"/"undefined" produced by decodeURIComponent(parameters.get(...)) when resourceUrl is absent', () => {
            // redirect.js calls decodeURIComponent(parameters.get('resourceUrl')); a missing param
            // becomes the string "null", which must not be treated as a navigable relative path.
            expect(isSafeRelativeUrl('null')).toBe(false);
            expect(isSafeRelativeUrl('undefined')).toBe(false);
        });
    });

    describe('normalization is applied to the whole value, not just the prefix', () => {
        test('a control character anywhere in the string is stripped before the leading-slash check, so "/x" + CR + "/..." stays accepted as a path', () => {
            expect(isSafeRelativeUrl('/patients\r/123')).toBe(true);
        });

        test('every backslash in the value is converted, so a mid-string "\\\\" is treated the same as "//" for the prefix decision only', () => {
            // Mid-string double separators are still same-origin paths; only the *leading* pair is
            // origin-changing. This pins the exact contract so a future "reject any //" change is caught.
            expect(isSafeRelativeUrl('/a\\\\b')).toBe(true);
            expect(isSafeRelativeUrl('/a//b')).toBe(true);
        });

        test('the function is pure: repeated calls with the same input return the same verdict and the input is not mutated', () => {
            const input = '/\t/evil.com';
            expect(isSafeRelativeUrl(input)).toBe(false);
            expect(isSafeRelativeUrl(input)).toBe(false);
            expect(input).toBe('/\t/evil.com');
        });
    });
});
