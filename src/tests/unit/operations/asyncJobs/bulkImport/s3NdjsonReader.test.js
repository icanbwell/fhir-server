'use strict';

const { Readable } = require('stream');
const { describe, test, expect, beforeEach, jest: jestObj } = require('@jest/globals');

const mockSend = jestObj.fn();

// Mock AWS SDK and dependencies
jestObj.mock('@aws-sdk/client-s3', () => ({
    S3Client: jestObj.fn().mockImplementation(() => ({
        send: mockSend
    })),
    GetObjectCommand: jestObj.fn().mockImplementation((input) => ({ input }))
}));

jestObj.mock('../../../../../utils/assertType', () => ({
    assertTypeEquals: jestObj.fn()
}));

jestObj.mock('../../../../../operations/common/logging', () => ({
    logInfo: jestObj.fn(),
    logError: jestObj.fn()
}));

const { S3NdjsonReader } = require('../../../../../operations/asyncJobs/bulkImport/s3NdjsonReader');

describe('S3NdjsonReader', () => {
    let reader;
    let mockConfigManager;

    beforeEach(() => {
        mockConfigManager = {
            bulkImportAllowedS3Buckets: ['allowed-bucket', 'another-allowed'],
            awsRegion: 'us-east-1',
            bulkImportMaxLineSizeMb: 10
        };
        reader = new S3NdjsonReader({ configManager: mockConfigManager });
        mockSend.mockReset();
    });

    /**
     * Configures mockSend to serve byte ranges out of a fixed in-memory "file", the way
     * S3's Range header semantics work — each call returns exactly the requested slice.
     * @param {string} fullText
     */
    const serveFileFromMockS3 = (fullText) => {
        const buf = Buffer.from(fullText, 'utf8');
        mockSend.mockImplementation((command) => {
            const match = command.input.Range.match(/^bytes=(\d+)-(\d+)$/);
            const start = parseInt(match[1], 10);
            const end = parseInt(match[2], 10);
            return Promise.resolve({ Body: Readable.from([buf.slice(start, end + 1)]) });
        });
    };

    /**
     * Drains an async generator into an array.
     * @param {AsyncGenerator} gen
     */
    const collect = async (gen) => {
        const results = [];
        for await (const item of gen) {
            results.push(item);
        }
        return results;
    };

    describe('parseS3Uri', () => {
        test('parses valid S3 URI', () => {
            const result = reader.parseS3Uri('s3://my-bucket/path/to/file.ndjson');
            expect(result).toEqual({ bucket: 'my-bucket', key: 'path/to/file.ndjson' });
        });

        test('parses S3 URI with complex key', () => {
            const result = reader.parseS3Uri('s3://bucket/a/b/c/d.json');
            expect(result).toEqual({ bucket: 'bucket', key: 'a/b/c/d.json' });
        });

        test('throws for invalid S3 URI format', () => {
            expect(() => reader.parseS3Uri('https://bucket/key')).toThrow(/Invalid S3 URI/);
            expect(() => reader.parseS3Uri('/local/path')).toThrow(/Invalid S3 URI/);
            expect(() => reader.parseS3Uri('')).toThrow(/Invalid S3 URI/);
            expect(() => reader.parseS3Uri('s3://')).toThrow(/Invalid S3 URI/);
        });

        test('throws for S3 URI without key', () => {
            expect(() => reader.parseS3Uri('s3://bucket-only/')).toThrow(/Invalid S3 URI/);
        });
    });

    describe('readNdjsonAsync parameter validation', () => {
        test('throws for invalid fileSize', async () => {
            const gen = reader.readNdjsonAsync({
                filepath: 's3://allowed-bucket/file.ndjson',
                byteRangeStart: 0,
                byteRangeEnd: 100,
                fileSize: 0
            });
            await expect(gen.next()).rejects.toThrow(/Invalid fileSize/);
        });

        test('throws for negative fileSize', async () => {
            const gen = reader.readNdjsonAsync({
                filepath: 's3://allowed-bucket/file.ndjson',
                byteRangeStart: 0,
                byteRangeEnd: 100,
                fileSize: -1
            });
            await expect(gen.next()).rejects.toThrow(/Invalid fileSize/);
        });

        test('throws for NaN fileSize', async () => {
            const gen = reader.readNdjsonAsync({
                filepath: 's3://allowed-bucket/file.ndjson',
                byteRangeStart: 0,
                byteRangeEnd: 100,
                fileSize: NaN
            });
            await expect(gen.next()).rejects.toThrow(/Invalid fileSize/);
        });

        test('throws for negative byteRangeStart', async () => {
            const gen = reader.readNdjsonAsync({
                filepath: 's3://allowed-bucket/file.ndjson',
                byteRangeStart: -1,
                byteRangeEnd: 100,
                fileSize: 1000
            });
            await expect(gen.next()).rejects.toThrow(/Invalid byteRangeStart/);
        });

        test('throws for byteRangeEnd <= byteRangeStart', async () => {
            const gen = reader.readNdjsonAsync({
                filepath: 's3://allowed-bucket/file.ndjson',
                byteRangeStart: 100,
                byteRangeEnd: 100,
                fileSize: 1000
            });
            await expect(gen.next()).rejects.toThrow(/Invalid byteRangeEnd/);
        });

        test('throws for disallowed S3 bucket (SSRF protection)', async () => {
            const gen = reader.readNdjsonAsync({
                filepath: 's3://evil-bucket/data.ndjson',
                byteRangeStart: 0,
                byteRangeEnd: 100,
                fileSize: 1000
            });
            await expect(gen.next()).rejects.toThrow(/not in the allowed list/);
        });

        test('throws when bucket allowlist is empty', async () => {
            mockConfigManager.bulkImportAllowedS3Buckets = [];
            const gen = reader.readNdjsonAsync({
                filepath: 's3://allowed-bucket/data.ndjson',
                byteRangeStart: 0,
                byteRangeEnd: 100,
                fileSize: 1000
            });
            await expect(gen.next()).rejects.toThrow(/allowlist is not configured/);
        });

        test('bucket validation is case-sensitive', async () => {
            const gen = reader.readNdjsonAsync({
                filepath: 's3://Allowed-Bucket/data.ndjson',
                byteRangeStart: 0,
                byteRangeEnd: 100,
                fileSize: 1000
            });
            await expect(gen.next()).rejects.toThrow(/not in the allowed list/);
        });
    });

    describe('readNdjsonAsync byte offset tracking', () => {
        const lines = [
            '{"resourceType":"Patient","id":"p1"}',
            '{"resourceType":"Patient","id":"p2"}',
            '{"resourceType":"Patient","id":"p3"}'
        ];
        const fullText = lines.join('\n') + '\n';
        const fileSize = Buffer.byteLength(fullText, 'utf8');
        const line1Bytes = Buffer.byteLength(lines[0], 'utf8') + 1;
        const line2Bytes = Buffer.byteLength(lines[1], 'utf8') + 1;

        test('reports byte offsets matching true file positions when the whole file is a single range', async () => {
            serveFileFromMockS3(fullText);

            const results = await collect(reader.readNdjsonAsync({
                filepath: 's3://allowed-bucket/file.ndjson',
                byteRangeStart: 0,
                byteRangeEnd: fileSize,
                fileSize
            }));

            expect(results.map((r) => r.resource.id)).toEqual(['p1', 'p2', 'p3']);
            expect(results.map((r) => r.byteOffset)).toEqual([0, line1Bytes, line1Bytes + line2Bytes]);
        });

        test('byte offset reflects true position in the file (not reset to 0) for a range starting mid-file', async () => {
            serveFileFromMockS3(fullText);

            // Starts a few bytes into line 1, simulating an arbitrary byte-range split like an
            // orchestrator splitting a large file — the partial leading fragment of line 1 is
            // skipped ("the previous range owns it").
            const results = await collect(reader.readNdjsonAsync({
                filepath: 's3://allowed-bucket/file.ndjson',
                byteRangeStart: 5,
                byteRangeEnd: fileSize,
                fileSize
            }));

            expect(results.map((r) => r.resource.id)).toEqual(['p2', 'p3']);
            // lineNumber (1, 2) only counts lines seen within THIS range and would wrongly
            // suggest these are the file's first two lines. byteOffset is the line's true
            // absolute position in the original file regardless of where the range began —
            // exactly the distinction that matters once the orchestrator starts splitting
            // large files into more than one range.
            expect(results.map((r) => r.lineNumber)).toEqual([1, 2]);
            expect(results.map((r) => r.byteOffset)).toEqual([line1Bytes, line1Bytes + line2Bytes]);
        });
    });
});
