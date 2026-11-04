const { BadRequestError, NotFoundError } = require('../../utils/httpErrors');
const { RESOURCE_CLOUD_STORAGE_PATH_KEY } = require('../../constants');
const { IdParser } = require('../../utils/idParser');

/**
 * Arguments a ClickHouse history read honours or can safely ignore. Anything else (for example
 * `_lastUpdated`) would be dropped silently and change what the caller gets, so it is rejected.
 * `_uuid` and `_historyCursor` are not parsed arguments; they are attached by the operations manager.
 * @type {Set<string>}
 */
const SUPPORTED_ARGS = new Set([
    'base_version', 'id', '_id', 'version_id', '_count', '_format', '_pretty', '_prefer', '_bundle',
    '_keepOldUI', '_metaUuid', '_explain', '_debug', '_useAccessIndex', '_setIndexHint', '_streamResponse', 'streamResponse'
]);

/**
 * @param {import('../query/parsedArgs').ParsedArgs} parsedArgs
 * @param {{allowIdArgs?: boolean}} [options] pass false for a type-level history, where an id filter would be ignored
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
 * The read is keyed on `_uuid`, so make sure it belongs to the resource named in the URL.
 * @param {Object} params
 * @param {Object[]} params.entries history BundleEntry objects
 * @param {string|undefined} params.id id from the URL; undefined for a type-level history
 * @throws {NotFoundError} when an entry belongs to a different resource than the URL id
 */
function assertEntriesMatchUrlId({ entries, id }) {
    if (id === undefined || id === null || id === '') {
        return;
    }
    // The URL id may be `id|owner`; match on the id part, as the MongoDB path does
    const { id: urlId } = IdParser.parse(String(id));
    const matches = (entry) => [entry.resource?.id, entry.resource?._uuid, entry.resource?._sourceId]
        .some((candidate) => candidate !== undefined && String(candidate) === urlId);
    if (!entries.every(matches)) {
        throw new NotFoundError(new Error('History not found for the requested id'));
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
    assertEntriesMatchUrlId,
    assertNoCloudStorageStubs
};
