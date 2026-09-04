const zlib = require('zlib');
const { Transform } = require('stream');
const bytesParse = require('bytes');
const { UnsupportedMediaTypeError, PayloadTooLargeError } = require('./httpErrors');
const { logWarn } = require('../operations/common/logging');

/**
 * Fallback cap on decompressed request bodies, used when no limit is passed in or the one that
 * was passed in can't be parsed. Matches ConfigManager.payloadLimit's own default.
 * @type {string}
 */
const DEFAULT_MAX_DECOMPRESSED_SIZE = '50mb';

/**
 * Guards against decompression-bomb DoS: the buffered $merge path gets a body-size cap for
 * free from express.json({limit: payloadLimit}), but streaming $merge reads the raw request
 * stream directly and express.json() never runs on it. Without this, a small compressed
 * request body could decompress to an unbounded amount of data before the ndjson parser (or
 * anything else downstream) ever sees it, exhausting memory.
 */
class DecompressedSizeLimitTransform extends Transform {
    /**
     * @param {{maxBytes: number, operationName: string}} params
     */
    constructor ({ maxBytes, operationName }) {
        super();
        this.maxBytes = maxBytes;
        this.operationName = operationName;
        this.bytesSeen = 0;
    }

    _transform (chunk, encoding, callback) {
        this.bytesSeen += chunk.length;
        if (this.bytesSeen > this.maxBytes) {
            callback(new PayloadTooLargeError(new Error(
                `Decompressed ${this.operationName} body exceeds the maximum allowed size of ` +
                `${this.maxBytes} bytes (see the PAYLOAD_LIMIT env var)`
            )));
            return;
        }
        callback(null, chunk);
    }
}

/**
 * Parses a payload-limit string (e.g. '50mb') into a byte count, falling back to the default if
 * it can't be parsed. `bytes()` returns null for an unparseable value, and a null maxBytes would
 * make every size comparison below true - failing every compressed request with a 413 - so an
 * unparseable PAYLOAD_LIMIT must not be passed through silently. Falling back keeps the limit
 * enforced (unlike body-parser, which treats an unparseable limit as no limit at all) while the
 * warning surfaces the misconfiguration.
 *
 * @param {string|number} maxDecompressedSize
 * @returns {number} the cap in bytes
 */
function resolveMaxBytes (maxDecompressedSize) {
    const maxBytes = bytesParse(maxDecompressedSize);
    if (maxBytes !== null && maxBytes !== undefined) {
        return maxBytes;
    }
    logWarn(
        `requestDecompressor: could not parse "${maxDecompressedSize}" as a size ` +
        `(check the PAYLOAD_LIMIT env var); falling back to ${DEFAULT_MAX_DECOMPRESSED_SIZE}`,
        {}
    );
    return bytesParse(DEFAULT_MAX_DECOMPRESSED_SIZE);
}

/**
 * Returns the decompression Transform stream(s) for the given Content-Encoding header value,
 * as an array suitable for spreading directly into a stream.pipeline() call - empty if the
 * body is not compressed (identity encoding). Mirrors body-parser's own supported encodings
 * (identity/gzip/deflate - no brotli, matching what express.json() itself supports), since a
 * raw-request-stream consumer (e.g. streaming $merge) doesn't get express.json()'s automatic
 * decompression - or its body-size limit - for free and must handle both itself.
 *
 * @param {string|undefined} contentEncodingHeader value of the request's content-encoding header
 * @param {string} [operationName] used in error messages if the encoding is unsupported or the
 *   decompressed body is too large
 * @param {string|number} [maxDecompressedSize] same format as ConfigManager.payloadLimit
 *   (e.g. '50mb') - the cap on decompressed bytes, mirroring the buffered path's payloadLimit
 * @returns {import('stream').Transform[]}
 * @throws {UnsupportedMediaTypeError} if the encoding is not identity/gzip/deflate
 */
function getRequestDecompressor (contentEncodingHeader, operationName = 'request', maxDecompressedSize = DEFAULT_MAX_DECOMPRESSED_SIZE) {
    const contentEncoding = (contentEncodingHeader || 'identity').toLowerCase();
    switch (contentEncoding) {
        case 'identity':
            return [];
        case 'gzip':
        case 'deflate': {
            const decompressStream = contentEncoding === 'gzip' ? zlib.createGunzip() : zlib.createInflate();
            const sizeLimitTransform = new DecompressedSizeLimitTransform({
                maxBytes: resolveMaxBytes(maxDecompressedSize),
                operationName
            });
            return [decompressStream, sizeLimitTransform];
        }
        default:
            throw new UnsupportedMediaTypeError(
                `Unsupported content-encoding "${contentEncoding}" for ${operationName}`
            );
    }
}

module.exports = {
    getRequestDecompressor,
    DecompressedSizeLimitTransform
};
