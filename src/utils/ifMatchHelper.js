/**
 * Strips the weak-validator prefix (W/) and surrounding quotes from an ETag value.
 * @param {string} etag
 * @returns {string}
 */
function normalizeETag (etag) {
    return (etag || '').replace(/^W\//, '').replace(/"/g, '');
}

/**
 * Parses a (possibly comma-separated) If-Match header value into normalized version ids.
 * @param {string|undefined} ifMatch
 * @returns {string[]}
 */
function parseIfMatchVersionIds (ifMatch) {
    return ifMatch ? ifMatch.split(',').map(v => normalizeETag(v.trim())) : [];
}

module.exports = { normalizeETag, parseIfMatchVersionIds };
