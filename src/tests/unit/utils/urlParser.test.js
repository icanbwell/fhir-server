'use strict';

const { describe, test, expect, beforeEach, jest: jestObj } = require('@jest/globals');

// Mock dependencies
jestObj.mock('../../../operations/common/logging', () => ({
    logWarn: jestObj.fn(),
    logDebug: jestObj.fn()
}));

const { UrlParser, validateUrl } = require('../../../utils/urlParser');

describe('urlParser', () => {
    describe('UrlParser.isUrl', () => {
        test('returns true for http:// URLs', () => {
            expect(UrlParser.isUrl('http://example.com')).toBe(true);
        });

        test('returns true for https:// URLs', () => {
            expect(UrlParser.isUrl('https://example.com')).toBe(true);
        });

        test('returns true for ftp:// URLs', () => {
            expect(UrlParser.isUrl('ftp://files.example.com')).toBe(true);
        });

        test('returns false for file:// URLs', () => {
            expect(UrlParser.isUrl('file:///etc/passwd')).toBe(false);
        });

        test('returns false for data: URLs', () => {
            expect(UrlParser.isUrl('data:text/html,<h1>Hi</h1>')).toBe(false);
        });

        test('returns false for gopher:// URLs', () => {
            expect(UrlParser.isUrl('gopher://evil.com')).toBe(false);
        });

        test('returns false for plain strings', () => {
            expect(UrlParser.isUrl('just a string')).toBe(false);
        });

        test('returns false for empty string', () => {
            expect(UrlParser.isUrl('')).toBe(false);
        });

        test('returns false for null', () => {
            expect(UrlParser.isUrl(null)).toBe(false);
        });

        test('returns false for undefined', () => {
            expect(UrlParser.isUrl(undefined)).toBe(false);
        });

        test('returns false for numbers', () => {
            expect(UrlParser.isUrl(12345)).toBe(false);
        });

        test('returns false for objects', () => {
            expect(UrlParser.isUrl({ url: 'http://example.com' })).toBe(false);
        });

        test('returns false for arrays', () => {
            expect(UrlParser.isUrl(['http://example.com'])).toBe(false);
        });

        test('returns false for boolean', () => {
            expect(UrlParser.isUrl(true)).toBe(false);
        });

        test('is case-sensitive - HTTP:// returns false', () => {
            expect(UrlParser.isUrl('HTTP://example.com')).toBe(false);
        });

        test('is case-sensitive - HTTPS:// returns false', () => {
            expect(UrlParser.isUrl('HTTPS://example.com')).toBe(false);
        });

        test('returns true for http with path and query', () => {
            expect(UrlParser.isUrl('http://example.com/path?key=val')).toBe(true);
        });

        test('returns true for https with port', () => {
            expect(UrlParser.isUrl('https://example.com:8443/api')).toBe(true);
        });
    });

    describe('validateUrl - protocol validation', () => {
        test('throws for file:// protocol (SSRF vector)', () => {
            expect(() => validateUrl('file:///etc/passwd')).toThrow('URL must use HTTP or HTTPS');
        });

        test('throws for gopher:// protocol (SSRF vector)', () => {
            expect(() => validateUrl('gopher://evil.com')).toThrow('URL must use HTTP or HTTPS');
        });

        test('throws for data: protocol', () => {
            expect(() => validateUrl('data:text/html,<script>alert(1)</script>')).toThrow('URL must use HTTP or HTTPS');
        });

        test('throws for ftp:// protocol', () => {
            expect(() => validateUrl('ftp://files.example.com/secret.txt')).toThrow('URL must use HTTP or HTTPS');
        });

        test('throws for javascript: protocol', () => {
            // URL constructor handles javascript: but it may not parse hostname
            expect(() => validateUrl('javascript:alert(1)')).toThrow();
        });

        test('does not throw for https:// protocol', () => {
            expect(() => validateUrl('https://example.com')).not.toThrow();
        });

        test('does not throw for http:// protocol', () => {
            expect(() => validateUrl('http://example.com')).not.toThrow();
        });

        test('includes rejected scheme name in error message', () => {
            expect(() => validateUrl('ftp://example.com')).toThrow('ftp');
        });
    });

    describe('validateUrl - invalid URL strings', () => {
        test('throws for completely invalid URL', () => {
            expect(() => validateUrl('not-a-url')).toThrow('Not a valid URL');
        });

        test('throws for empty string', () => {
            expect(() => validateUrl('')).toThrow('Not a valid URL');
        });

        test('throws for string with only spaces', () => {
            expect(() => validateUrl('   ')).toThrow('Not a valid URL');
        });
    });

    describe('validateUrl - private IP blocking (SSRF protection)', () => {
        test('blocks 10.x.x.x range', () => {
            expect(() => validateUrl('https://10.0.0.1/admin')).toThrow('private IP');
        });

        test('blocks 10.255.255.255', () => {
            expect(() => validateUrl('https://10.255.255.255')).toThrow('private IP');
        });

        test('blocks 172.16.0.1 (start of 172.16-31 range)', () => {
            expect(() => validateUrl('https://172.16.0.1')).toThrow('private IP');
        });

        test('blocks 172.31.255.255 (end of 172.16-31 range)', () => {
            expect(() => validateUrl('https://172.31.255.255')).toThrow('private IP');
        });

        test('allows 172.15.0.1 (below private range)', () => {
            expect(() => validateUrl('https://172.15.0.1')).not.toThrow();
        });

        test('allows 172.32.0.1 (above private range)', () => {
            expect(() => validateUrl('https://172.32.0.1')).not.toThrow();
        });

        test('blocks 192.168.1.1', () => {
            expect(() => validateUrl('https://192.168.1.1')).toThrow('private IP');
        });

        test('blocks 192.168.0.0', () => {
            expect(() => validateUrl('https://192.168.0.0')).toThrow('private IP');
        });

        test('allows 192.169.0.1 (not in private range)', () => {
            expect(() => validateUrl('https://192.169.0.1')).not.toThrow();
        });

        test('blocks cloud metadata endpoint 169.254.169.254', () => {
            expect(() => validateUrl('https://169.254.169.254/latest/meta-data')).toThrow('private IP');
        });

        test('blocks link-local 169.254.0.1', () => {
            expect(() => validateUrl('https://169.254.0.1')).toThrow('private IP');
        });

        test('blocks 127.0.0.2 (loopback range, non-localhost)', () => {
            // 127.0.0.2 is NOT localhost or 127.0.0.1, so isInternal is false
            // and isPrivateOrLoopbackIP returns true for 127.x.x.x
            expect(() => validateUrl('https://127.0.0.2')).toThrow('private IP');
        });
    });

    describe('validateUrl - localhost/127.0.0.1 internal bypass', () => {
        test('allows http://localhost (internal bypass)', () => {
            expect(() => validateUrl('http://localhost')).not.toThrow();
        });

        test('allows https://localhost', () => {
            expect(() => validateUrl('https://localhost')).not.toThrow();
        });

        test('allows http://127.0.0.1 (internal bypass)', () => {
            expect(() => validateUrl('http://127.0.0.1')).not.toThrow();
        });

        test('allows https://127.0.0.1', () => {
            expect(() => validateUrl('https://127.0.0.1')).not.toThrow();
        });

        test('allows localhost with port', () => {
            expect(() => validateUrl('http://localhost:8080/api')).not.toThrow();
        });

        test('allows 127.0.0.1 with path', () => {
            expect(() => validateUrl('http://127.0.0.1/fhir/Patient')).not.toThrow();
        });
    });

    describe('validateUrl - public IPs allowed', () => {
        test('allows public IP 8.8.8.8', () => {
            expect(() => validateUrl('https://8.8.8.8')).not.toThrow();
        });

        test('allows public IP 93.184.216.34', () => {
            expect(() => validateUrl('https://93.184.216.34')).not.toThrow();
        });

        test('allows public IP 1.1.1.1', () => {
            expect(() => validateUrl('https://1.1.1.1')).not.toThrow();
        });
    });

    describe('validateUrl - DNS hostnames allowed (potential DNS rebinding)', () => {
        test('allows regular DNS hostname', () => {
            expect(() => validateUrl('https://api.example.com')).not.toThrow();
        });

        test('allows DNS hostname even over HTTP (no protocol restriction for non-IP)', () => {
            // NOTE: This is a potential DNS rebinding vector - hostname could
            // resolve to a private IP at request time. Documented but not fixed
            // since DNS resolution happens after validation.
            expect(() => validateUrl('http://attacker.com')).not.toThrow();
        });

        test('allows subdomain hostnames', () => {
            expect(() => validateUrl('https://internal.corp.example.com')).not.toThrow();
        });
    });

    describe('validateUrl - IPv4 with leading zeros (octal bypass attempt)', () => {
        test('IP with leading zeros is not treated as valid IPv4', () => {
            // "010.0.0.1" - if parsed as octal, this is 8.0.0.1 (public)
            // but the isValidIPv4 check uses part === String(num) which rejects leading zeros
            // since Number("010") === 10 but String(10) !== "010"
            // So it falls through to the DNS hostname path and is allowed
            expect(() => validateUrl('https://010.0.0.1')).not.toThrow();
        });

        test('IP "0177.0.0.1" (octal 127.0.0.1) treated as hostname, not blocked', () => {
            // This is a potential bypass: octal notation for 127.0.0.1
            // isValidIPv4 rejects it (leading zeros), so it passes as a "hostname"
            expect(() => validateUrl('https://0177.0.0.1')).not.toThrow();
        });
    });
});

describe('isPrivateOrLoopbackIP (tested indirectly via validateUrl)', () => {
    // These tests exercise the private IP detection through validateUrl

    test('0.0.0.0 is not in any private range (edge case)', () => {
        // 0.0.0.0 is not in 10/8, 172.16/12, 192.168/16, 169.254/16, or 127/8
        expect(() => validateUrl('https://0.0.0.0')).not.toThrow();
    });

    test('255.255.255.255 is not in any private range', () => {
        expect(() => validateUrl('https://255.255.255.255')).not.toThrow();
    });

    test('11.0.0.1 is not private (boundary after 10.x)', () => {
        expect(() => validateUrl('https://11.0.0.1')).not.toThrow();
    });

    test('9.255.255.255 is not private (boundary before 10.x)', () => {
        expect(() => validateUrl('https://9.255.255.255')).not.toThrow();
    });
});
