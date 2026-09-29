'use strict';

const { describe, test, expect } = require('@jest/globals');
const { isValidMongoObjectId } = require('../../../utils/mongoIdValidator');

describe('isValidMongoObjectId', () => {
    test('returns true for valid 24-char hex ObjectId', () => {
        expect(isValidMongoObjectId('507f1f77bcf86cd799439011')).toBe(true);
    });

    test('returns false for short string', () => {
        expect(isValidMongoObjectId('123')).toBe(false);
    });

    test('returns false for UUID format', () => {
        expect(isValidMongoObjectId('a1b2c3d4-e5f6-7890-abcd-ef1234567890')).toBe(false);
    });

    test('returns false for 12-char string (valid ObjectId length but wrong hex)', () => {
        // ObjectId.isValid accepts 12-byte strings/buffers but String(new ObjectId(x)) !== x
        expect(isValidMongoObjectId('hello world!')).toBe(false);
    });

    test('returns false for empty string', () => {
        expect(isValidMongoObjectId('')).toBe(false);
    });

    test('returns false for numeric string of 24 chars', () => {
        expect(isValidMongoObjectId('123456789012345678901234')).toBe(true);
    });

    test('returns false for 24-char string with non-hex chars', () => {
        expect(isValidMongoObjectId('507f1f77bcf86cd79943901g')).toBe(false);
    });

    test('returns true for all-zero ObjectId', () => {
        expect(isValidMongoObjectId('000000000000000000000000')).toBe(true);
    });
});
