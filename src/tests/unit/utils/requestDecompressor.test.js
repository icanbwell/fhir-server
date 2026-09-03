'use strict';

const zlib = require('zlib');
const { describe, test, expect } = require('@jest/globals');

const { getRequestDecompressor } = require('../../../utils/requestDecompressor');

describe('getRequestDecompressor', () => {
    test('returns null for identity encoding', () => {
        expect(getRequestDecompressor('identity')).toBeNull();
    });

    test('returns null when no content-encoding header is present', () => {
        expect(getRequestDecompressor(undefined)).toBeNull();
    });

    test('returns a gunzip stream for gzip encoding', () => {
        const stream = getRequestDecompressor('gzip');
        expect(stream).toBeInstanceOf(zlib.Gunzip);
    });

    test('returns an inflate stream for deflate encoding', () => {
        const stream = getRequestDecompressor('deflate');
        expect(stream).toBeInstanceOf(zlib.Inflate);
    });

    test('is case-insensitive', () => {
        expect(getRequestDecompressor('GZIP')).toBeInstanceOf(zlib.Gunzip);
    });

    test('throws for an unsupported encoding (e.g. brotli)', () => {
        expect(() => getRequestDecompressor('br')).toThrow();
    });

    test('unsupported-encoding error carries a 415 status code and names the encoding', () => {
        // Note: this repo's ServerError base class resets the prototype chain in its own
        // constructor (see server.error.js), so instanceof checks against the specific
        // subclass (UnsupportedMediaTypeError) don't hold at runtime - this repo's own
        // httpErrors.test.js documents the same quirk for other subclasses. Assert on the
        // own `statusCode`/`message` properties instead, which Object.assign(this, options)
        // does set correctly.
        try {
            getRequestDecompressor('br', 'streaming $merge');
            throw new Error('expected getRequestDecompressor to throw');
        } catch (e) {
            expect(e.statusCode).toBe(415);
            expect(e.message).toContain('br');
            expect(e.message).toContain('streaming $merge');
        }
    });

    test('a real gzip payload actually decompresses back to the original bytes', async () => {
        const original = Buffer.from('{"resourceType":"Patient","id":"1"}\n{"resourceType":"Patient","id":"2"}');
        const compressed = zlib.gzipSync(original);
        const decompressor = getRequestDecompressor('gzip');

        const chunks = [];
        decompressor.on('data', (chunk) => chunks.push(chunk));
        const done = new Promise((resolve, reject) => {
            decompressor.on('end', resolve);
            decompressor.on('error', reject);
        });
        decompressor.end(compressed);
        await done;

        expect(Buffer.concat(chunks).toString('utf8')).toBe(original.toString('utf8'));
    });
});
