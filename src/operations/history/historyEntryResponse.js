/**
 * FHIR R4/R4B constraint bdl-4 makes `entry.response` mandatory for history Bundles.
 * New history documents are stored without `response` (DCON-6272), so it is synthesized at read time.
 */

const HTTP_STATUS_BY_METHOD = {
    POST: '201 Created',
    PUT: '200 OK',
    PATCH: '200 OK',
    DELETE: '204 No Content'
};

const DEFAULT_STATUS = '200 OK';

/**
 * Adds `response` to a history bundle entry when it is missing. Never overwrites an existing
 * `response` (legacy documents). Mutates and returns the entry.
 * @param {Object} historyEntry bundle entry with `.resource` and optional `.request`
 * @returns {Object}
 */
function ensureHistoryEntryResponse (historyEntry) {
    if (!historyEntry || historyEntry.response) {
        return historyEntry;
    }
    const method = typeof historyEntry.request?.method === 'string'
        ? historyEntry.request.method.toUpperCase()
        : undefined;
    const response = {
        status: (method && HTTP_STATUS_BY_METHOD[method]) || DEFAULT_STATUS
    };
    const meta = historyEntry.resource?.meta;
    if (meta?.versionId) {
        response.etag = `W/"${meta.versionId}"`;
    }
    if (meta?.lastUpdated) {
        response.lastModified = meta.lastUpdated;
    }
    historyEntry.response = response;
    return historyEntry;
}

module.exports = { ensureHistoryEntryResponse };
