'use strict';

const { describe, test, expect, jest: jestObj } = require('@jest/globals');

jestObj.mock('../../../utils/assertType', () => ({
    assertIsValid: jestObj.fn((val) => { if (!val) throw new Error('invalid'); })
}));

const { generateNonce } = require('../../../utils/nonce');

describe('generateNonce', () => {
    test('returns a base64 string', () => {
        const nonce = generateNonce();
        expect(typeof nonce).toBe('string');
        expect(nonce.length).toBeGreaterThan(0);
    });

    test('returns different values on each call', () => {
        const a = generateNonce();
        const b = generateNonce();
        expect(a).not.toBe(b);
    });

    test('default size produces 16-byte nonce (base64 length ~24)', () => {
        const nonce = generateNonce();
        const buf = Buffer.from(nonce, 'base64');
        expect(buf.length).toBe(16);
    });

    test('respects custom size parameter', () => {
        const nonce = generateNonce(32);
        const buf = Buffer.from(nonce, 'base64');
        expect(buf.length).toBe(32);
    });

    test('throws for non-integer size', () => {
        expect(() => generateNonce(3.5)).toThrow();
    });
});
