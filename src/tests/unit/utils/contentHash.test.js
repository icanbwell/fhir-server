'use strict';

const { describe, test, expect } = require('@jest/globals');
const { computeContentHashAsync } = require('../../../utils/contentHash');
const crypto = require('crypto');

describe('computeContentHashAsync', () => {
    test('returns a base64url string', async () => {
        const result = await computeContentHashAsync('hello world');
        expect(typeof result).toBe('string');
        // base64url chars only
        expect(result).toMatch(/^[A-Za-z0-9_-]+$/);
    });

    test('produces deterministic output for same input', async () => {
        const a = await computeContentHashAsync('test data');
        const b = await computeContentHashAsync('test data');
        expect(a).toBe(b);
    });

    test('produces different output for different inputs', async () => {
        const a = await computeContentHashAsync('hello');
        const b = await computeContentHashAsync('world');
        expect(a).not.toBe(b);
    });

    test('matches crypto sha256 base64url for small data', async () => {
        const data = 'small payload under threshold';
        const expected = crypto.createHash('sha256').update(data).digest('base64url');
        const result = await computeContentHashAsync(data);
        expect(result).toBe(expected);
    });

    test('handles empty string', async () => {
        const result = await computeContentHashAsync('');
        const expected = crypto.createHash('sha256').update('').digest('base64url');
        expect(result).toBe(expected);
    });

    test('produces same hash for data above chunk threshold (chunked path)', async () => {
        // Create data larger than SYNC_THRESHOLD_BYTES (256KB)
        const data = 'x'.repeat(300 * 1024);
        const expected = crypto.createHash('sha256').update(data).digest('base64url');
        const result = await computeContentHashAsync(data);
        expect(result).toBe(expected);
    });
});
