const zlib = require('zlib');
const { UnsupportedMediaTypeError } = require('./httpErrors');

/**
 * Returns a decompression Transform stream for the given Content-Encoding header value, or
 * null if the body is not compressed (identity encoding). Mirrors body-parser's own supported
 * encodings (identity/gzip/deflate - no brotli, matching what express.json() itself supports),
 * since a raw-request-stream consumer (e.g. streaming $merge) doesn't get express.json()'s
 * automatic decompression for free and must handle it itself.
 *
 * @param {string|undefined} contentEncodingHeader value of the request's content-encoding header
 * @param {string} [operationName] used in the error message if the encoding is unsupported
 * @returns {import('stream').Transform|null}
 * @throws {UnsupportedMediaTypeError} if the encoding is not identity/gzip/deflate
 */
function getRequestDecompressor (contentEncodingHeader, operationName = 'request') {
    const contentEncoding = (contentEncodingHeader || 'identity').toLowerCase();
    switch (contentEncoding) {
        case 'identity':
            return null;
        case 'gzip':
            return zlib.createGunzip();
        case 'deflate':
            return zlib.createInflate();
        default:
            throw new UnsupportedMediaTypeError(
                `Unsupported content-encoding "${contentEncoding}" for ${operationName}`
            );
    }
}

module.exports = {
    getRequestDecompressor
};
