'use strict';

const { describe, test, expect } = require('@jest/globals');
const {
    getHash,
    generateUUID,
    isUuid,
    generateUUIDv5,
    convertToMongoUuid,
    convertFromMongoUuid
} = require('../../../utils/uid.util');
const { UUID } = require('mongodb').BSON;

describe('uid.util', () => {
    describe('getHash', () => {
        test('returns deterministic hash for same object', () => {
            const obj = { name: 'test', value: 123 };
            const hash1 = getHash(obj);
            const hash2 = getHash(obj);
            expect(hash1).toBe(hash2);
        });

        test('returns different hash for different objects', () => {
            const hash1 = getHash({ a: 1 });
            const hash2 = getHash({ a: 2 });
            expect(hash1).not.toBe(hash2);
        });

        test('returns a string', () => {
            const result = getHash({ key: 'value' });
            expect(typeof result).toBe('string');
        });
    });

    describe('generateUUIDv5', () => {
        test('returns deterministic UUID for same name', () => {
            const uuid1 = generateUUIDv5('test-name');
            const uuid2 = generateUUIDv5('test-name');
            expect(uuid1).toBe(uuid2);
        });

        test('returns different UUIDs for different names', () => {
            const uuid1 = generateUUIDv5('name-a');
            const uuid2 = generateUUIDv5('name-b');
            expect(uuid1).not.toBe(uuid2);
        });

        test('returns a valid UUID format', () => {
            const uuid = generateUUIDv5('hello');
            const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
            expect(uuid).toMatch(uuidPattern);
        });
    });

    describe('generateUUID', () => {
        test('returns a valid UUID', () => {
            const uuid = generateUUID();
            const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
            expect(uuid).toMatch(uuidPattern);
        });

        test('returns different UUIDs on each call', () => {
            const uuid1 = generateUUID();
            const uuid2 = generateUUID();
            const uuid3 = generateUUID();
            expect(uuid1).not.toBe(uuid2);
            expect(uuid2).not.toBe(uuid3);
        });
    });

    describe('isUuid', () => {
        test('returns truthy for valid UUID v4', () => {
            expect(isUuid('550e8400-e29b-41d4-a716-446655440000')).toBeTruthy();
        });

        test('returns truthy for valid UUID v5', () => {
            const uuid = generateUUIDv5('test');
            expect(isUuid(uuid)).toBeTruthy();
        });

        test('returns falsy for non-UUID string', () => {
            expect(isUuid('not-a-uuid')).toBeFalsy();
        });

        test('returns falsy for null', () => {
            expect(isUuid(null)).toBeFalsy();
        });

        test('returns falsy for undefined', () => {
            expect(isUuid(undefined)).toBeFalsy();
        });

        test('returns falsy for empty string', () => {
            expect(isUuid('')).toBeFalsy();
        });

        test('returns truthy for UUID without dashes pattern match', () => {
            // The regex checks for the standard dashed format
            expect(isUuid('12345678-1234-1234-1234-123456789abc')).toBeTruthy();
        });
    });

    describe('convertToMongoUuid', () => {
        test('returns same UUID instance if already a UUID', () => {
            const mongoUuid = new UUID();
            const result = convertToMongoUuid(mongoUuid);
            expect(result).toBe(mongoUuid);
        });

        test('converts hex string to mongo UUID', () => {
            const hexString = '550e8400e29b41d4a716446655440000';
            const result = convertToMongoUuid(hexString);
            expect(result).toBeInstanceOf(UUID);
        });
    });

    describe('convertFromMongoUuid', () => {
        test('converts mongo UUID to hex string with dashes', () => {
            const hexString = '550e8400e29b41d4a716446655440000';
            const mongoUuid = UUID.createFromHexString(hexString);
            const result = convertFromMongoUuid(mongoUuid);
            expect(typeof result).toBe('string');
            expect(result).toContain('-');
        });

        test('roundtrip: convertTo then convertFrom returns equivalent string', () => {
            const hexString = '550e8400e29b41d4a716446655440000';
            const mongoUuid = convertToMongoUuid(hexString);
            const result = convertFromMongoUuid(mongoUuid);
            expect(result.replace(/-/g, '')).toBe(hexString);
        });
    });
});
