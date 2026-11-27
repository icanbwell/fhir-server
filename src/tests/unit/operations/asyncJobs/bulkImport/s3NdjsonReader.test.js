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
const metrics = require('../../../../../utils/metrics');
jestObj.spyOn(metrics.importS3ReadThroughputHistogram, 'record');

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
        metrics.importS3ReadThroughputHistogram.record.mockClear();
    });

    /**
     * Configures mockSend to serve byte ranges out of a fixed in-memory "file", the way
     * S3's Range header semantics work — each call returns exactly the requested slice.
     * @param {string} fullText
     * @param {number} [bodyChunkSize] split each response body into chunks of this many bytes,
     * the way a network stream can deliver it (default: one chunk)
     */
    const serveFileFromMockS3 = (fullText, bodyChunkSize) => {
        const buf = Buffer.from(fullText, 'utf8');
        mockSend.mockImplementation((command) => {
            const match = command.input.Range.match(/^bytes=(\d+)-(\d+)$/);
            const start = parseInt(match[1], 10);
            const end = parseInt(match[2], 10);
            const body = buf.subarray(start, end + 1);
            const chunks = [];
            for (let i = 0; i < body.length; i += bodyChunkSize || body.length || 1) {
                chunks.push(body.subarray(i, i + (bodyChunkSize || body.length)));
            }
            return Promise.resolve({ Body: Readable.from(chunks) });
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

        test('marks a validation error as non-retryable -- it would fail identically on every attempt', async () => {
            const gen = reader.readNdjsonAsync({
                filepath: 's3://allowed-bucket/file.ndjson',
                byteRangeStart: 0,
                byteRangeEnd: 100,
                fileSize: 0
            });
            await expect(gen.next()).rejects.toMatchObject({ retryable: false });
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

    describe('readNdjsonAsync line terminators and multi-byte characters', () => {
        const readAll = async (text, bodyChunkSize, byteRangeStart = 0) => {
            const fileSize = Buffer.byteLength(text, 'utf8');
            serveFileFromMockS3(text, bodyChunkSize);
            return collect(reader.readNdjsonAsync({
                filepath: 's3://allowed-bucket/file.ndjson',
                byteRangeStart,
                byteRangeEnd: fileSize,
                fileSize
            }));
        };

        // synthetic names; the family name has a 2-byte character so single-byte body chunks
        // split it
        test.each([
            ['LF', '\n'],
            ['CRLF', '\r\n']
        ])('reports true file byte offsets for %s line endings', async (label, eol) => {
            const lines = ['{"id":"p1","family":"Muñoz"}', '{"id":"p2"}', '{"id":"p3"}'];
            const text = lines.join(eol) + eol;
            const expectedOffsets = [];
            let offset = 0;
            for (const line of lines) {
                expectedOffsets.push(offset);
                offset += Buffer.byteLength(line, 'utf8') + eol.length;
            }

            const results = await readAll(text);

            expect(results.map((r) => r.resource.id)).toEqual(['p1', 'p2', 'p3']);
            expect(results.map((r) => r.byteOffset)).toEqual(expectedOffsets);
            expect(results[0].resource.family).toBe('Muñoz');
        });

        test('starts a later range on the correct line after CRLF line endings', async () => {
            const lines = ['{"id":"p1"}', '{"id":"p2"}', '{"id":"p3"}'];
            const text = lines.join('\r\n') + '\r\n';
            const line1Bytes = Buffer.byteLength(lines[0], 'utf8') + 2;

            // starts a few bytes into line 1, so line 1 belongs to the previous range
            const results = await readAll(text, undefined, 3);

            expect(results.map((r) => r.resource.id)).toEqual(['p2', 'p3']);
            expect(results[0].byteOffset).toBe(line1Bytes);
        });

        test.each([1, 2, 3, 7])(
            'keeps multi-byte characters intact when the body arrives in %i-byte chunks',
            async (bodyChunkSize) => {
                const text = '{"id":"p1","family":"Muñ€😀"}\r\n{"id":"p2"}';

                const results = await readAll(text, bodyChunkSize);

                expect(results.map((r) => r.parseError)).toEqual([null, null]);
                expect(results[0].resource.family).toBe('Muñ€😀');
                expect(results[1].resource.id).toBe('p2');
            }
        );
    });

    describe('readNdjsonAsync byte ranges', () => {
        // every split of the file into [0, E) and [E, size] must yield each line exactly once,
        // with the same byte offsets as reading the whole file in one range
        test.each([
            ['LF', '\n'],
            ['CRLF', '\r\n']
        ])('splits %s lines across two ranges with no gap or duplicate at any boundary', async (label, eol) => {
            const text = ['{"id":"p1","family":"Muñoz"}', '{"id":"p2"}', '{"id":"p3"}'].join(eol) + eol;
            const fileSize = Buffer.byteLength(text, 'utf8');
            serveFileFromMockS3(text);
            const read = (byteRangeStart, byteRangeEnd) => collect(reader.readNdjsonAsync({
                filepath: 's3://allowed-bucket/file.ndjson',
                byteRangeStart,
                byteRangeEnd,
                fileSize
            }));
            const whole = (await read(0, fileSize)).map((r) => [r.resource.id, r.byteOffset]);

            for (let boundary = 1; boundary < fileSize; boundary++) {
                const first = await read(0, boundary);
                const second = await read(boundary, fileSize);
                const combined = [...first, ...second].map((r) => [r.resource.id, r.byteOffset]);
                expect({ boundary, combined }).toEqual({ boundary, combined: whole });
            }
        });

        test('stops reading and destroys the stream once a non-final range is done', async () => {
            const text = ['{"id":"p1"}', '{"id":"p2"}', '{"id":"p3"}', '{"id":"p4"}'].join('\n') + '\n';
            const fileSize = Buffer.byteLength(text, 'utf8');
            const body = Readable.from([Buffer.from(text, 'utf8')]);
            mockSend.mockResolvedValue({ Body: body });

            const results = await collect(reader.readNdjsonAsync({
                filepath: 's3://allowed-bucket/file.ndjson',
                byteRangeStart: 0,
                byteRangeEnd: 5,
                fileSize
            }));

            expect(results.map((r) => r.resource.id)).toEqual(['p1']);
            expect(body.destroyed).toBe(true);
        });

        test('does not treat a lone CR as a line break', async () => {
            const text = '{"id":"p1"}\r{"id":"p2"}\n{"id":"p3"}\n';
            const fileSize = Buffer.byteLength(text, 'utf8');
            serveFileFromMockS3(text);

            const results = await collect(reader.readNdjsonAsync({
                filepath: 's3://allowed-bucket/file.ndjson',
                byteRangeStart: 0,
                byteRangeEnd: fileSize,
                fileSize
            }));

            expect(results).toHaveLength(2);
            expect(results[0].parseError).not.toBeNull();
            expect(results[1].resource.id).toBe('p3');
        });

        test('reports an oversize line without buffering it and keeps later offsets exact', async () => {
            // a limit of exactly 100 bytes
            mockConfigManager.bulkImportMaxLineSizeMb = 100 / (1024 * 1024);
            const oversize = '{"id":"big","pad":"' + 'x'.repeat(5000) + '"}';
            const text = '{"id":"p1"}\r\n' + oversize + '\r\n{"id":"p3"}\r\n';
            const fileSize = Buffer.byteLength(text, 'utf8');
            serveFileFromMockS3(text, 64);

            const results = await collect(reader.readNdjsonAsync({
                filepath: 's3://allowed-bucket/file.ndjson',
                byteRangeStart: 0,
                byteRangeEnd: fileSize,
                fileSize
            }));

            expect(results.map((r) => (r.resource ? r.resource.id : 'error'))).toEqual(['p1', 'error', 'p3']);
            expect(results[1].parseError.message).toContain('exceeds maximum size');
            expect(results[2].byteOffset).toBe(Buffer.byteLength(text, 'utf8') - '{"id":"p3"}\r\n'.length);
        });
    });

    describe('readNdjsonAsync per-line error handling', () => {
        test('skips an invalid-JSON line (yielding a parseError) instead of aborting the rest of the range', async () => {
            const badText = '{"resourceType":"Patient","id":"p1"}\nnot-json\n{"resourceType":"Patient","id":"p2"}\n';
            const badFileSize = Buffer.byteLength(badText, 'utf8');
            serveFileFromMockS3(badText);

            const results = await collect(reader.readNdjsonAsync({
                filepath: 's3://allowed-bucket/file.ndjson',
                byteRangeStart: 0,
                byteRangeEnd: badFileSize,
                fileSize: badFileSize
            }));

            expect(results).toHaveLength(3);
            expect(results[0]).toMatchObject({ resource: { id: 'p1' }, parseError: null });
            expect(results[1].resource).toBeNull();
            expect(results[1].parseError).toBeInstanceOf(Error);
            expect(results[1].parseError.message).toMatch(/Invalid JSON at line 2/);
            expect(results[2]).toMatchObject({ resource: { id: 'p2' }, parseError: null });
        });

        test('skips a line exceeding the max size (yielding a parseError) instead of aborting the rest of the range', async () => {
            const oversizedLine = JSON.stringify({ resourceType: 'Patient', id: 'p1', extra: 'x'.repeat(20 * 1024 * 1024) });
            const text = `${oversizedLine}\n{"resourceType":"Patient","id":"p2"}\n`;
            const fileSizeForTest = Buffer.byteLength(text, 'utf8');
            serveFileFromMockS3(text);

            const results = await collect(reader.readNdjsonAsync({
                filepath: 's3://allowed-bucket/file.ndjson',
                byteRangeStart: 0,
                byteRangeEnd: fileSizeForTest,
                fileSize: fileSizeForTest
            }));

            expect(results).toHaveLength(2);
            expect(results[0].resource).toBeNull();
            expect(results[0].parseError.message).toMatch(/exceeds maximum size/);
            expect(results[1]).toMatchObject({ resource: { id: 'p2' }, parseError: null });
        });
    });

    describe('BAI-229: fhir_import_s3_read_throughput_bytes_per_second', () => {
        const lines = [
            '{"resourceType":"Patient","id":"p1"}',
            '{"resourceType":"Patient","id":"p2"}'
        ];
        const fullText = lines.join('\n') + '\n';
        const fileSize = Buffer.byteLength(fullText, 'utf8');

        test('records throughput once after a successful full read', async () => {
            serveFileFromMockS3(fullText);
            // Real elapsed time for an in-memory mock read is often sub-millisecond, which
            // Date.now()'s resolution can round to a 0ms delta -- mock it so the 50ms elapsed
            // window (and therefore a positive, non-flaky throughput value) is deterministic.
            const nowSpy = jestObj.spyOn(Date, 'now')
                .mockReturnValueOnce(1_000)
                .mockReturnValueOnce(1_050);

            await collect(reader.readNdjsonAsync({
                filepath: 's3://allowed-bucket/file.ndjson',
                byteRangeStart: 0,
                byteRangeEnd: fileSize,
                fileSize
            }));

            expect(metrics.importS3ReadThroughputHistogram.record).toHaveBeenCalledTimes(1);
            // bytesRead - byteRangeStart == fileSize for a single full-file range; 50ms elapsed.
            expect(metrics.importS3ReadThroughputHistogram.record).toHaveBeenCalledWith(fileSize / 0.05);

            nowSpy.mockRestore();
        });

        test('does not record (divide-by-zero guard) when elapsed duration is 0', async () => {
            serveFileFromMockS3(fullText);
            const nowSpy = jestObj.spyOn(Date, 'now')
                .mockReturnValueOnce(1_000)
                .mockReturnValueOnce(1_000);

            await collect(reader.readNdjsonAsync({
                filepath: 's3://allowed-bucket/file.ndjson',
                byteRangeStart: 0,
                byteRangeEnd: fileSize,
                fileSize
            }));

            expect(metrics.importS3ReadThroughputHistogram.record).not.toHaveBeenCalled();

            nowSpy.mockRestore();
        });

        test('records a partial (zero-byte) throughput data point when the GetObject call itself fails', async () => {
            mockSend.mockRejectedValue(new Error('S3 unavailable'));
            const nowSpy = jestObj.spyOn(Date, 'now')
                .mockReturnValueOnce(1_000)
                .mockReturnValueOnce(1_050);

            const gen = reader.readNdjsonAsync({
                filepath: 's3://allowed-bucket/file.ndjson',
                byteRangeStart: 0,
                byteRangeEnd: fileSize,
                fileSize
            });

            await expect(gen.next()).rejects.toThrow('S3 unavailable');

            // finally still runs on the thrown GetObject error. Zero bytes were read before the
            // failure, so the recorded throughput is 0 -- a real (if unhelpful on its own)
            // partial-read data point, not suppressed like the zero-duration case above.
            expect(metrics.importS3ReadThroughputHistogram.record).toHaveBeenCalledWith(0);

            nowSpy.mockRestore();
        });

        test('does not record for a parameter-validation failure (throws before the finally-wrapped read starts)', async () => {
            const gen = reader.readNdjsonAsync({
                filepath: 's3://allowed-bucket/file.ndjson',
                byteRangeStart: 0,
                byteRangeEnd: 100,
                fileSize: 0
            });

            await expect(gen.next()).rejects.toThrow(/Invalid fileSize/);
            expect(metrics.importS3ReadThroughputHistogram.record).not.toHaveBeenCalled();
        });
    });
});
