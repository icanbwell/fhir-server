const { describe, test, expect, beforeEach, jest: jestObj } = require('@jest/globals');
const { BufferToChunkTransferResponse } = require('../../../utils/buffer_to_chunk_transfer_response');

describe('BufferToChunkTransferResponse', () => {
    let instance;
    let mockResponse;

    beforeEach(() => {
        instance = new BufferToChunkTransferResponse();
        mockResponse = {
            setHeader: jestObj.fn(),
            statusCode: 200,
            end: jestObj.fn(),
            write: jestObj.fn((chunk, cb) => {
                if (cb) cb();
                return true;
            }),
            on: jestObj.fn((event, handler) => {
                if (event === 'finish') {
                    // Store the finish handler to call later
                    mockResponse._finishHandler = handler;
                }
                if (event === 'close') {
                    mockResponse._closeHandler = handler;
                }
                return mockResponse;
            }),
            once: jestObj.fn().mockReturnThis(),
            emit: jestObj.fn().mockReturnThis(),
            removeListener: jestObj.fn().mockReturnThis(),
            // Make it writable-stream compatible
            writable: true,
            _write: jestObj.fn(),
            _finishHandler: null,
            _closeHandler: null
        };
    });

    describe('sendLargeFileChunkedAsync', () => {
        test('sets Transfer-Encoding header to chunked', async () => {
            const buffer = Buffer.from('hello');

            // Use a real writable stream approach
            const { PassThrough } = require('stream');
            const passThrough = new PassThrough();
            passThrough.setHeader = jestObj.fn();
            passThrough.statusCode = 200;

            const promise = instance.sendLargeFileChunkedAsync({
                response: passThrough,
                buffer,
                chunkSize: 1024
            });

            // Consume the stream to trigger finish
            passThrough.resume();
            await promise;

            expect(passThrough.setHeader).toHaveBeenCalledWith('Transfer-Encoding', 'chunked');
        });

        test('streams a small buffer correctly', async () => {
            const { PassThrough } = require('stream');
            const passThrough = new PassThrough();
            passThrough.setHeader = jestObj.fn();

            const testData = 'Hello, World!';
            const buffer = Buffer.from(testData);
            const chunks = [];

            passThrough.on('data', (chunk) => {
                chunks.push(chunk);
            });

            const promise = instance.sendLargeFileChunkedAsync({
                response: passThrough,
                buffer,
                chunkSize: 1024
            });

            await promise;

            const result = Buffer.concat(chunks).toString();
            expect(result).toBe(testData);
        });

        test('streams a buffer in multiple chunks when buffer is larger than chunkSize', async () => {
            const { PassThrough } = require('stream');
            const passThrough = new PassThrough();
            passThrough.setHeader = jestObj.fn();

            const testData = 'ABCDEFGHIJ'; // 10 bytes
            const buffer = Buffer.from(testData);
            const chunks = [];

            passThrough.on('data', (chunk) => {
                chunks.push(chunk);
            });

            const promise = instance.sendLargeFileChunkedAsync({
                response: passThrough,
                buffer,
                chunkSize: 3
            });

            await promise;

            const result = Buffer.concat(chunks).toString();
            expect(result).toBe(testData);
            // With chunkSize 3, 10 bytes should require at least 4 chunks
            expect(chunks.length).toBeGreaterThanOrEqual(4);
        });

        test('handles an empty buffer', async () => {
            const { PassThrough } = require('stream');
            const passThrough = new PassThrough();
            passThrough.setHeader = jestObj.fn();

            const buffer = Buffer.alloc(0);
            const chunks = [];

            passThrough.on('data', (chunk) => {
                chunks.push(chunk);
            });

            const promise = instance.sendLargeFileChunkedAsync({
                response: passThrough,
                buffer,
                chunkSize: 1024
            });

            await promise;

            const result = Buffer.concat(chunks).toString();
            expect(result).toBe('');
        });

        test('uses default chunkSize of 64KB when not specified', async () => {
            const { PassThrough } = require('stream');
            const passThrough = new PassThrough();
            passThrough.setHeader = jestObj.fn();

            // Create a buffer larger than 64KB
            const size = 128 * 1024;
            const buffer = Buffer.alloc(size, 'x');
            const chunks = [];

            passThrough.on('data', (chunk) => {
                chunks.push(chunk);
            });

            const promise = instance.sendLargeFileChunkedAsync({
                response: passThrough,
                buffer
            });

            await promise;

            const result = Buffer.concat(chunks);
            expect(result.length).toBe(size);
            // With 64KB chunks for 128KB buffer, there should be exactly 2 chunks
            // (though stream internals may combine/split)
            expect(chunks.length).toBeGreaterThanOrEqual(2);
        });

        test('resolves when response emits finish event', async () => {
            const { PassThrough } = require('stream');
            const passThrough = new PassThrough();
            passThrough.setHeader = jestObj.fn();

            const buffer = Buffer.from('test data');

            const promise = instance.sendLargeFileChunkedAsync({
                response: passThrough,
                buffer,
                chunkSize: 1024
            });

            passThrough.resume();

            await expect(promise).resolves.toBeUndefined();
        });

        test('large binary data is transferred correctly', async () => {
            const { PassThrough } = require('stream');
            const passThrough = new PassThrough();
            passThrough.setHeader = jestObj.fn();

            // Create buffer with various byte values
            const buffer = Buffer.alloc(256);
            for (let i = 0; i < 256; i++) {
                buffer[i] = i;
            }

            const chunks = [];
            passThrough.on('data', (chunk) => {
                chunks.push(chunk);
            });

            const promise = instance.sendLargeFileChunkedAsync({
                response: passThrough,
                buffer,
                chunkSize: 50
            });

            await promise;

            const result = Buffer.concat(chunks);
            expect(result).toEqual(buffer);
        });
    });
});
