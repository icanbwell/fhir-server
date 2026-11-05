const { BadRequestError, ForbiddenError } = require('../../utils/httpErrors');
const { RESOURCE_CLOUD_STORAGE_PATH_KEY, AUTH_USER_TYPES } = require('../../constants');
const { generateUUIDv5, isUuid } = require('../../utils/uid.util');
const { IdParser } = require('../../utils/idParser');
const { HISTORY_MAX_IDS } = require('../../constants/clickHouseConstants');

/**
 * Arguments a ClickHouse history read honours or can safely ignore. Anything else (for example
 * `_lastUpdated`) would be dropped silently and change what the caller gets, so it is rejected.
 * `_historyCursor` and `_since` are not parsed arguments; they are attached by the operations manager.
 * @type {Set<string>}
 */
const SUPPORTED_ARGS = new Set([
    'base_version', 'id', '_id', 'version_id', '_count', '_format', '_pretty', '_prefer', '_bundle',
    '_keepOldUI', '_metaUuid', '_explain', '_debug', '_useAccessIndex', '_setIndexHint', '_streamResponse', 'streamResponse'
]);

/**
 * @param {import('../query/parsedArgs').ParsedArgs} parsedArgs
 * @param {{isInstanceRead?: boolean}} [options] false for a type-level read, which takes its id from `_id`
 * @throws {BadRequestError} when an argument the ClickHouse history read cannot honour is present
 */
function assertSupportedHistoryArgs(parsedArgs, { isInstanceRead = true } = {}) {
    // The id comes from the URL on an instance read and from `_id` on a type-level read; the other
    // form would be a second, conflicting id, so it is rejected rather than ignored.
    const idArgNotAllowed = isInstanceRead ? '_id' : 'id';
    const unsupported = Object.keys(parsedArgs.getRawArgs()).filter(
        (name) => !SUPPORTED_ARGS.has(name) || name === idArgNotAllowed
    );
    if (unsupported.length > 0) {
        throw new BadRequestError(new Error(
            `${unsupported.join(', ')} not supported when history is read from ClickHouse`
        ));
    }
}

/**
 * A ClickHouse history read is keyed on the resource `_uuid`. The URL id is either that uuid or
 * `id|owner`, which the server turns into the uuid the same way it does when it writes a resource
 * (UUIDv5 of `id|owner`); no lookup is done. Anything else (no id, a bare source id that is not a
 * uuid) is ambiguous across owners and is rejected before a query runs.
 * @param {Object} params
 * @param {string|undefined} params.id id from the URL
 * @param {string} params.resourceType
 * @return {string} the resource `_uuid`
 * @throws {BadRequestError} when the id is neither a uuid nor `id|owner`
 */
function resolveHistoryUuid({ id, resourceType }) {
    // a comma list is several ids, which one history read cannot serve
    if (typeof id === 'string' && id.length > 0 && !id.includes(',')) {
        if (isUuid(id)) {
            return id;
        }
        const { id: sourceId, sourceAssigningAuthority } = IdParser.parse(id);
        if (sourceId && sourceAssigningAuthority) {
            return generateUUIDv5(`${sourceId}|${sourceAssigningAuthority}`);
        }
    }
    throw new BadRequestError(new Error(
        `${resourceType} history must be read as /${resourceType}/{uuid}/_history or ` +
        `/${resourceType}/{id}|{owner}/_history`
    ));
}

/**
 * Resolves the `_id` of a type-level read, which may list several ids (`_id=a,b` or a repeated `_id`).
 * Each is a uuid or `id|owner`, converted as in resolveHistoryUuid.
 * @param {Object} params
 * @param {string|string[]|undefined} params.idValue the `_id` argument
 * @param {string} params.resourceType
 * @return {string[]} distinct resource `_uuid` values, in request order
 * @throws {BadRequestError} when an id is invalid, or more than HISTORY_MAX_IDS are listed
 */
function resolveHistoryUuids({ idValue, resourceType }) {
    const ids = (Array.isArray(idValue) ? idValue : [idValue])
        .flatMap((value) => (typeof value === 'string' ? value.split(',') : [value]));
    if (ids.length > HISTORY_MAX_IDS) {
        throw new BadRequestError(new Error(`_id may list at most ${HISTORY_MAX_IDS} ids`));
    }
    return [...new Set(ids.map((id) => resolveHistoryUuid({ id, resourceType })))];
}

/**
 * The MongoDB history path hides versions a delegated actor has no consent for (the sensitive-data
 * exclusion on `meta.security`). ClickHouse reads do not apply that filter, so a delegated user
 * must not be served from ClickHouse.
 * @param {Object} params
 * @param {string|undefined} params.userType requestInfo.userType
 * @param {string} params.resourceType
 * @throws {ForbiddenError} when the caller is a delegated user
 */
function assertNotDelegatedUser({ userType, resourceType }) {
    if (userType === AUTH_USER_TYPES.delegatedUser) {
        throw new ForbiddenError(
            `delegated access is not allowed to read ${resourceType} history from ClickHouse`
        );
    }
}

/**
 * Parses the optional `_since` argument of a ClickHouse history read: an ISO 8601 date or instant,
 * applied to the time the version was recorded.
 * @param {*} value
 * @return {number|undefined} epoch milliseconds, or undefined when `_since` was not sent
 * @throws {BadRequestError} when it is repeated or not a valid date
 */
function parseSinceArg(value) {
    if (value === undefined) {
        return undefined;
    }
    const ms = typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value) ? Date.parse(value) : NaN;
    if (Number.isNaN(ms)) {
        throw new BadRequestError(new Error('_since must be a single ISO 8601 date or instant'));
    }
    return ms;
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
    resolveHistoryUuid,
    resolveHistoryUuids,
    assertNotDelegatedUser,
    parseSinceArg,
    assertNoCloudStorageStubs
};
