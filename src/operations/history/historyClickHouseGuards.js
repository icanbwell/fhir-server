const { BadRequestError } = require('../../utils/httpErrors');
const { RESOURCE_CLOUD_STORAGE_PATH_KEY } = require('../../constants');
const { isUuid } = require('../../utils/uid.util');

/**
 * Arguments a ClickHouse history read honours or can safely ignore. Anything else (for example
 * `_lastUpdated`) would be dropped silently and change what the caller gets, so it is rejected.
 * `_historyCursor` is not a parsed argument; it is attached by the operations manager.
 * @type {Set<string>}
 */
const SUPPORTED_ARGS = new Set([
    'base_version', 'id', 'version_id', '_count', '_format', '_pretty', '_prefer', '_bundle',
    '_keepOldUI', '_metaUuid', '_explain', '_debug', '_useAccessIndex', '_setIndexHint', '_streamResponse', 'streamResponse'
]);

/**
 * @param {import('../query/parsedArgs').ParsedArgs} parsedArgs
 * @param {{allowIdArgs?: boolean}} [options] false for a type-level read, where an id filter would be ignored
 * @throws {BadRequestError} when an argument the ClickHouse history read cannot honour is present
 */
function assertSupportedHistoryArgs(parsedArgs, { allowIdArgs = true } = {}) {
    const unsupported = Object.keys(parsedArgs.getRawArgs()).filter(
        (name) => !SUPPORTED_ARGS.has(name) || (!allowIdArgs && (name === 'id' || name === '_id'))
    );
    if (unsupported.length > 0) {
        throw new BadRequestError(new Error(
            `${unsupported.join(', ')} not supported when history is read from ClickHouse`
        ));
    }
}

/**
 * A ClickHouse history read is keyed on the resource `_uuid`, which must be the URL id. Reject
 * anything else (no id, `id|owner`, a source id) before a query runs; no id lookup is done.
 * @param {Object} params
 * @param {string|undefined} params.id id from the URL
 * @param {string} params.resourceType
 * @throws {BadRequestError} when the id is not a uuid
 */
function assertHistoryIdIsUuid({ id, resourceType }) {
    if (typeof id !== 'string' || !isUuid(id)) {
        throw new BadRequestError(new Error(
            `${resourceType} history must be read as /${resourceType}/{uuid}/_history with the resource _uuid as the id`
        ));
    }
}

/**
 * A history entry that was moved to cloud storage is only a stub; its body cannot be served from
 * ClickHouse, so fail loudly instead of returning an empty entry.
 * @param {Object[]} entries history BundleEntry objects
 * @throws {Error} when an entry is a cloud storage stub
 */
function assertNoCloudStorageStubs(entries) {
    if (entries.some((entry) => entry[RESOURCE_CLOUD_STORAGE_PATH_KEY])) {
        throw new Error('A history entry is stored in cloud storage and cannot be read from ClickHouse');
    }
}

module.exports = {
    assertSupportedHistoryArgs,
    assertHistoryIdIsUuid,
    assertNoCloudStorageStubs
};
