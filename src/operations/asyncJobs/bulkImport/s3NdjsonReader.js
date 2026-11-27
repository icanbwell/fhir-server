const { S3Client: S3, GetObjectCommand, PutObjectCommand } = require('@aws-sdk/client-s3');
const { assertTypeEquals } = require('../../../utils/assertType');
const { ConfigManager } = require('../../../utils/configManager');
const { logInfo, logError } = require('../../common/logging');
const { recordImportS3ReadThroughput } = require('../../../utils/metrics');

/**
 * Marks an error as deterministic (bad input/config, not a transient S3/network issue) so
 * callers like BulkImportHandler.readRangeWithRetryAsync can skip retrying it -- it would
 * fail identically on every attempt.
 * @param {string} message
 * @returns {Error}
 */
function nonRetryableError (message) {
    const error = new Error(message);
    error.retryable = false;
    return error;
}

const NEWLINE_BYTE = 0x0a;
const CARRIAGE_RETURN_BYTE = 0x0d;

/**
 * Splits a byte stream into lines on "\n" without decoding, so the caller sees the exact number
 * of bytes each line occupies in the source (including a "\r\n" terminator, which a decoding line
 * reader such as readline strips without reporting) and a multi-byte character is never decoded
 * in pieces.
 *
 * A line longer than maxLineBytes is not buffered: its bytes are counted and dropped until the
 * next "\n", and it is reported with content === null, so memory stays bounded by maxLineBytes
 * whatever the input holds.
 * @param {AsyncIterable<Buffer|string>} body
 * @param {number} maxLineBytes
 * @returns {AsyncGenerator<{content: Buffer|null, rawBytes: number, terminatorBytes: number}>}
 * content excludes the "\n" terminator (and is null for an oversize line); rawBytes is the line's
 * length before the terminator; terminatorBytes is 0 only for a final line with no trailing newline
 */
async function * readRawLinesAsync (body, maxLineBytes) {
    // one extra byte of slack: a "\r" ahead of the "\n" is the terminator, not line content
    const maxRawBytes = maxLineBytes + 1;
    let parts = [];
    let rawBytes = 0;
    let discarding = false;

    for await (const chunk of body) {
        const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        let segmentStart = 0;
        while (true) {
            const newlineIndex = bytes.indexOf(NEWLINE_BYTE, segmentStart);
            const segmentEnd = newlineIndex === -1 ? bytes.length : newlineIndex;
            const segmentBytes = segmentEnd - segmentStart;

            if (!discarding && rawBytes + segmentBytes > maxRawBytes) {
                discarding = true;
                parts = [];
            }
            if (!discarding && segmentBytes > 0) {
                parts.push(bytes.subarray(segmentStart, segmentEnd));
            }
            rawBytes += segmentBytes;

            if (newlineIndex === -1) {
                break;
            }
            yield {
                content: discarding ? null : Buffer.concat(parts, rawBytes),
                rawBytes,
                terminatorBytes: 1
            };
            parts = [];
            rawBytes = 0;
            discarding = false;
            segmentStart = newlineIndex + 1;
        }
    }
    if (rawBytes > 0) {
        yield {
            content: discarding ? null : Buffer.concat(parts, rawBytes),
            rawBytes,
            terminatorBytes: 0
        };
    }
}

class S3NdjsonReader {
    /**
     * @typedef {Object} ConstructorParams
     * @property {ConfigManager} configManager
     *
     * @param {ConstructorParams}
     */
    constructor({ configManager }) {
        this.configManager = configManager;
        assertTypeEquals(configManager, ConfigManager);
    }

    /**
     * @param {string} uri
     * @returns {{ bucket: string, key: string }}
     */
    parseS3Uri(uri) {
        const match = uri.match(/^s3:\/\/([^/]+)\/(.+)$/);
        if (!match) {
            throw nonRetryableError(`Invalid S3 URI: "${uri}"`);
        }
        return { bucket: match[1], key: match[2] };
    }

    /**
     * Streams an S3 object (or byte range) and yields parsed NDJSON lines.
     * Validates the bucket against the configured allow-list to prevent SSRF.
     * Lines end at LF (\n); a CR immediately before it (CRLF) is part of the terminator.
     * A lone CR does not end a line. byteOffset and range splitting use the exact source
     * byte counts, so LF and CRLF files are both handled correctly.
     *
     * When reading a byte range that is not the start of the file, the first
     * partial line is skipped (the previous range owns it). When reading a
     * range that is not the end of the file, one extra line past the boundary
     * is read to complete the last line that started inside this range.
     *
     * @param {Object} params
     * @param {string} params.filepath - S3 URI (s3://bucket/key)
     * @param {number} params.byteRangeStart
     * @param {number} params.byteRangeEnd
     * @param {number} params.fileSize - total file size from HEAD
     * @returns {AsyncGenerator<{ lineNumber: number, byteOffset: number, resource: Object|null, parseError: Error|null }, void, void>}
     */
    async *readNdjsonAsync({ filepath, byteRangeStart, byteRangeEnd, fileSize }) {
        if (!Number.isFinite(fileSize) || fileSize <= 0) {
            throw nonRetryableError(`Invalid fileSize ${fileSize} for "${filepath}"`);
        }
        if (!Number.isFinite(byteRangeStart) || byteRangeStart < 0) {
            throw nonRetryableError(`Invalid byteRangeStart ${byteRangeStart} for "${filepath}"`);
        }
        if (!Number.isFinite(byteRangeEnd) || byteRangeEnd <= byteRangeStart) {
            throw nonRetryableError(`Invalid byteRangeEnd ${byteRangeEnd} for "${filepath}"`);
        }

        const { bucket, key } = this.parseS3Uri(filepath);

        const allowedBuckets = this.configManager.bulkImportAllowedS3Buckets;
        if (!allowedBuckets.length) {
            throw nonRetryableError('Bulk import S3 bucket allowlist is not configured');
        }
        if (!allowedBuckets.includes(bucket)) {
            throw nonRetryableError(`S3 bucket "${bucket}" is not in the allowed list`);
        }

        const region = this.configManager.awsRegion || 'us-east-1';
        const s3 = new S3({ region });
        const maxLineSizeBytes = this.configManager.bulkImportMaxLineSizeMb * 1024 * 1024;
        const isFirstRange = byteRangeStart === 0;
        const isLastRange = byteRangeEnd >= fileSize;

        const readEnd = isLastRange ? fileSize - 1 : byteRangeEnd + maxLineSizeBytes;
        const rangeHeader = `bytes=${byteRangeStart}-${Math.min(readEnd, fileSize - 1)}`;

        logInfo('S3 NDJSON reader starting', {
            filepath,
            byteRangeStart,
            byteRangeEnd,
            rangeHeader
        });

        const startTimeMs = Date.now();
        let lineNumber = 0;
        let bytesRead = byteRangeStart;

        try {
            const response = await s3.send(new GetObjectCommand({
                Bucket: bucket,
                Key: key,
                Range: rangeHeader
            }));

            let skippedFirst = isFirstRange;

            for await (const { content, rawBytes, terminatorBytes } of readRawLinesAsync(
                response.Body,
                maxLineSizeBytes
            )) {
                // exact source bytes, so byteOffset stays correct for CRLF files too
                const lineBytes = rawBytes + terminatorBytes;
                bytesRead += lineBytes;

                if (!skippedFirst) {
                    skippedFirst = true;
                    continue;
                }

                if (!isLastRange && bytesRead - lineBytes > byteRangeEnd) {
                    break;
                }

                // content is null for a line over the size limit (it was counted, not buffered)
                let line = null;
                let contentBytes = rawBytes;
                if (content !== null) {
                    // a "\r" before the "\n" is part of the terminator, not the line
                    if (content[content.length - 1] === CARRIAGE_RETURN_BYTE) {
                        contentBytes -= 1;
                    }
                    line = content.toString('utf8', 0, contentBytes);
                    if (line.trim().length === 0) {
                        continue;
                    }
                }

                lineNumber++;
                // lineNumber resets to 1 at the start of every byte range, so it only
                // identifies a line within THIS range, not within the original file once a
                // file is split into multiple ranges. byteOffset is the line's absolute start
                // position in the full file (bytesRead already includes byteRangeStart), so it
                // stays correct regardless of how the file was split.
                const byteOffset = bytesRead - lineBytes;

                // A single bad line (too large, unparseable) must not abort the rest of the
                // range -- skip it and let the caller record it in the error output, the same
                // way a per-resource write failure is handled.
                if (line === null || contentBytes > maxLineSizeBytes) {
                    yield {
                        lineNumber,
                        byteOffset,
                        resource: null,
                        parseError: new Error(
                            `Line ${lineNumber} in "${filepath}" exceeds maximum size of ` +
                            `${this.configManager.bulkImportMaxLineSizeMb} MB`
                        )
                    };
                    continue;
                }

                let parsed;
                try {
                    parsed = JSON.parse(line);
                } catch (e) {
                    yield {
                        lineNumber,
                        byteOffset,
                        resource: null,
                        parseError: new Error(`Invalid JSON at line ${lineNumber} in "${filepath}": ${e.message}`)
                    };
                    continue;
                }

                yield { lineNumber, byteOffset, resource: parsed, parseError: null };
            }

            logInfo('S3 NDJSON reader finished', {
                filepath,
                byteRangeStart,
                byteRangeEnd,
                linesRead: lineNumber
            });
        } finally {
            // In `finally` (not after the success log above) so a partial read -- the S3
            // GetObject call fails, the stream errors mid-range, or the caller stops
            // iterating early -- still reports the throughput actually achieved for
            // whatever was read before the exit, mirroring the merge boundary's
            // finally-based emission (see docs/adr/0002).
            recordImportS3ReadThroughput(bytesRead - byteRangeStart, (Date.now() - startTimeMs) / 1000);
        }
    }

    /**
     * Writes NDJSON data to S3. Validates the bucket against the same allow-list
     * as readNdjsonAsync to prevent SSRF.
     * @param {Object} params
     * @param {string} params.filepath - S3 URI (s3://bucket/key)
     * @param {string} params.data
     * @returns {Promise<void>}
     */
    async writeNdjsonAsync({ filepath, data }) {
        const { bucket, key } = this.parseS3Uri(filepath);

        const allowedBuckets = this.configManager.bulkImportAllowedS3Buckets;
        if (!allowedBuckets.length) {
            throw new Error('Bulk import S3 bucket allowlist is not configured');
        }
        if (!allowedBuckets.includes(bucket)) {
            throw new Error(`S3 bucket "${bucket}" is not in the allowed list`);
        }

        const region = this.configManager.awsRegion || 'us-east-1';
        const s3 = new S3({ region });

        await s3.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: data }));

        logInfo('S3 NDJSON writer finished', { filepath });
    }
}

module.exports = { S3NdjsonReader };
