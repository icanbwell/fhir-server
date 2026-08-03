const crypto = require('crypto');
const { BASE64_DATA_HASH: H } = require('../constants');

/**
 * Content hash of a base64 payload string, rendered base64url so it doubles as an S3 key segment
 * (used for the history bucket's content-addressed key and for write-time change detection).
 * Payloads over `SYNC_THRESHOLD_BYTES` are hashed in `CHUNK_BYTES` slices, yielding to the event
 * loop between slices so a large payload never blocks it for long. Total CPU is unchanged.
 * @param {string} data
 * @returns {Promise<string>} base64url SHA-256 digest
 */
async function computeContentHashAsync (data) {
    const hash = crypto.createHash(H.ALGORITHM);
    if (data.length <= H.SYNC_THRESHOLD_BYTES) {
        return hash.update(data).digest(H.ENCODING);
    }
    for (let i = 0; i < data.length; i += H.CHUNK_BYTES) {
        hash.update(data.slice(i, i + H.CHUNK_BYTES));
        await new Promise(setImmediate);
    }
    return hash.digest(H.ENCODING);
}

module.exports = { computeContentHashAsync };
