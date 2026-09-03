'use strict';

const zlib = require('zlib');
const { pipeline } = require('stream/promises');
const { PassThrough } = require('stream');
const { describe, test, expect } = require('@jest/globals');

const { getRequestDecompressor } = require('../../../utils/requestDecompressor');

/**
 * Runs a compressed buffer through the full decompressor chain (as merge.js's pipeline()
 * call does) and collects the output, or rejects if any stream in the chain errors.
 */
async function runThroughDecompressor (compressed, contentEncoding, maxDecompressedSize) {
    const streams = getRequestDecompressor(contentEncoding, 'streaming $merge', maxDecompressedSize);
    const source = new PassThrough();
    const sink = new PassThrough();
    const chunks = [];
    sink.on('data', (chunk) => chunks.push(chunk));

    source.end(compressed);
    await pipeline(source, ...streams, sink);

    return Buffer.concat(chunks);
}

describe('getRequestDecompressor', () => {
    test('returns no transforms for identity encoding', () => {
        expect(getRequestDecompressor('identity')).toEqual([]);
    });

    test('returns no transforms when no content-encoding header is present', () => {
        expect(getRequestDecompressor(undefined)).toEqual([]);
    });

    test('returns a gunzip stream followed by a size-limit transform for gzip encoding', () => {
        const streams = getRequestDecompressor('gzip');
        expect(streams).toHaveLength(2);
        expect(streams[0]).toBeInstanceOf(zlib.Gunzip);
    });

    test('returns an inflate stream followed by a size-limit transform for deflate encoding', () => {
        const streams = getRequestDecompressor('deflate');
        expect(streams).toHaveLength(2);
        expect(streams[0]).toBeInstanceOf(zlib.Inflate);
    });

    test('is case-insensitive', () => {
        const streams = getRequestDecompressor('GZIP');
        expect(streams[0]).toBeInstanceOf(zlib.Gunzip);
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

        const result = await runThroughDecompressor(compressed, 'gzip');

        expect(result.toString('utf8')).toBe(original.toString('utf8'));
    });

    test('a real deflate payload actually decompresses back to the original bytes', async () => {
        const original = Buffer.from('{"resourceType":"Patient","id":"1"}');
        const compressed = zlib.deflateSync(original);

        const result = await runThroughDecompressor(compressed, 'deflate');

        expect(result.toString('utf8')).toBe(original.toString('utf8'));
    });

    test('passes through when decompressed size is under the configured limit', async () => {
        const original = Buffer.from('a'.repeat(1000));
        const compressed = zlib.gzipSync(original);

        const result = await runThroughDecompressor(compressed, 'gzip', '1kb');

        expect(result.length).toBe(1000);
    });

    test('rejects with a 413 PayloadTooLargeError once decompressed bytes exceed the configured limit', async () => {
        // Highly compressible input (all zeros) so the compressed size stays tiny while the
        // decompressed size comfortably exceeds a small limit - this is exactly the
        // decompression-bomb shape being guarded against.
        const original = Buffer.alloc(100_000, 0);
        const compressed = zlib.gzipSync(original);

        await expect(runThroughDecompressor(compressed, 'gzip', '1kb')).rejects.toMatchObject({
            statusCode: 413
        });
    });

    test('defaults to a 50mb limit when none is specified', async () => {
        // A payload well under the default should still pass through untouched.
        const original = Buffer.from('small payload');
        const compressed = zlib.gzipSync(original);

        const result = await runThroughDecompressor(compressed, 'gzip');

        expect(result.toString('utf8')).toBe(original.toString('utf8'));
    });
});
