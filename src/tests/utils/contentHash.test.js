const { describe, test, expect } = require('@jest/globals');
const crypto = require('crypto');
const { computeContentHashAsync } = require('../../utils/contentHash');

describe('computeContentHashAsync', () => {
    const oneShot = (s) => crypto.createHash('sha256').update(s).digest('base64url');

    test('small payload matches one-shot base64url sha256', async () => {
        const data = 'QmluYXJ5Q29udHJhY3RUZXN0';
        expect(await computeContentHashAsync(data)).toBe(oneShot(data));
    });

    test('large payload (chunked path) matches one-shot digest', async () => {
        const data = 'A'.repeat(3 * 1024 * 1024); // 3 MB → exercises the chunked branch
        expect(await computeContentHashAsync(data)).toBe(oneShot(data));
    });

    test('digest is base64url (no +, /, or = padding)', async () => {
        const h = await computeContentHashAsync('A'.repeat(2 * 1024 * 1024));
        expect(h).toMatch(/^[A-Za-z0-9_-]+$/);
    });
});
