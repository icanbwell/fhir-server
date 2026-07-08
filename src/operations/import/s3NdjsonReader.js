const { S3Client: S3, GetObjectCommand } = require('@aws-sdk/client-s3');
const readline = require('readline');
const { assertTypeEquals } = require('../../utils/assertType');
const { ConfigManager } = require('../../utils/configManager');
const { logInfo, logError } = require('../common/logging');

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
            throw new Error(`Invalid S3 URI: "${uri}"`);
        }
        return { bucket: match[1], key: match[2] };
    }

    /**
     * Streams an S3 object (or byte range) and yields parsed NDJSON lines.
     * Assumes LF (\n) line terminators — byte accounting uses +1 per line.
     * Input files are produced by Spark's .write.text() which always uses LF.
     * CRLF files would miscount bytes and corrupt range boundaries.
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
     * @returns {AsyncGenerator<{ lineNumber: number, resource: Object }, void, void>}
     */
    async *readNdjsonAsync({ filepath, byteRangeStart, byteRangeEnd, fileSize }) {
        if (!Number.isFinite(fileSize) || fileSize <= 0) {
            throw new Error(`Invalid fileSize ${fileSize} for "${filepath}"`);
        }
        
        const allowedBuckets = this.configManager.bulkImportAllowedS3Buckets;
        if (!allowedBuckets.length) {
            throw new Error('Bulk import S3 bucket allowlist is not configured');
        }
        
        const { bucket } = this.parseS3Uri(filepath);
        if (!allowedBuckets.includes(bucket)) {
            throw new Error(`S3 bucket "${bucket}" is not in the allowed list`);
        }
        if (!Number.isFinite(byteRangeStart) || byteRangeStart < 0) {
            throw new Error(`Invalid byteRangeStart ${byteRangeStart} for "${filepath}"`);
        }
        if (!Number.isFinite(byteRangeEnd) || byteRangeEnd <= byteRangeStart) {
            throw new Error(`Invalid byteRangeEnd ${byteRangeEnd} for "${filepath}"`);
        }

        const { bucket, key } = this.parseS3Uri(filepath);
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

        const response = await s3.send(new GetObjectCommand({
            Bucket: bucket,
            Key: key,
            Range: rangeHeader
        }));

        const rl = readline.createInterface({
            input: response.Body,
            crlfDelay: Infinity
        });

        let lineNumber = 0;
        let bytesRead = byteRangeStart;
        let skippedFirst = isFirstRange;

        for await (const line of rl) {
            const lineBytes = Buffer.byteLength(line, 'utf8') + 1; // +1 for newline
            bytesRead += lineBytes;

            if (!skippedFirst) {
                skippedFirst = true;
                continue;
            }

            if (!isLastRange && bytesRead - lineBytes > byteRangeEnd) {
                break;
            }

            if (line.trim().length === 0) {
                continue;
            }

            lineNumber++;

            if (Buffer.byteLength(line, 'utf8') > maxLineSizeBytes) {
                throw new Error(
                    `Line ${lineNumber} in "${filepath}" exceeds maximum size of ` +
                    `${this.configManager.bulkImportMaxLineSizeMb} MB`
                );
            }

            let parsed;
            try {
                parsed = JSON.parse(line);
            } catch (e) {
                throw new Error(
                    `Invalid JSON at line ${lineNumber} in "${filepath}": ${e.message}`
                );
            }

            yield { lineNumber, resource: parsed };
        }

        logInfo('S3 NDJSON reader finished', {
            filepath,
            byteRangeStart,
            byteRangeEnd,
            linesRead: lineNumber
        });
    }
}

module.exports = { S3NdjsonReader };
