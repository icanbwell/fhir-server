const { TABLES } = require('../../constants/clickHouseConstants');
const { assertIsValid } =require('../../utils/assertType');
const { BadRequestError } = require('../../utils/httpErrors');
const { RethrownError } = require('../../utils/rethrownError');
const { logDebug, logError } = require('../../operations/common/logging');
const metrics = require('../../utils/metrics');

/**
 * Reads FHIR resource versions from the ClickHouse history table. Every query is keyed on
 * resource_type and _uuid (the leading columns of the table's ORDER BY), so no query can scan
 * across resource types or across ids.
 */
class HistoryClickHouseRepository {
    /**
     * @param {Object} params
     * @param {import('../../utils/clickHouseClientManager').ClickHouseClientManager} params.clickHouseClientManager
     */
    constructor({ clickHouseClientManager }) {
        this.clickHouseClientManager = clickHouseClientManager;
    }

    /**
     * Encodes the position of the last row of a page as an opaque token. `uuid` is only part of the
     * position for a type-level read, where rows of many resources are interleaved.
     * @param {{recordedMs: number, versionNumber: number, uuid?: string}} position
     * @return {string}
     */
    static encodeCursor({ recordedMs, versionNumber, uuid }) {
        return Buffer.from(
            JSON.stringify({ r: recordedMs, v: versionNumber, ...(uuid ? { u: uuid } : {}) })
        ).toString('base64url');
    }

    /**
     * @param {string} cursor
     * @return {{recordedMs: number, versionNumber: number, uuid: string|undefined}}
     * @throws {BadRequestError} when the token was not produced by encodeCursor
     */
    static decodeCursor(cursor) {
        try {
            const { r, v, u } = JSON.parse(Buffer.from(String(cursor), 'base64url').toString('utf8'));
            if (Number.isSafeInteger(r) && Number.isSafeInteger(v) && v >= 0 &&
                (u === undefined || typeof u === 'string')) {
                return { recordedMs: r, versionNumber: v, uuid: u };
            }
        } catch (e) {
            // fall through to the error below
        }
        throw new BadRequestError(new Error('_historyCursor is not valid'));
    }

    /**
     * Returns one page of versions, newest first. With `uuid` it is the history of one resource;
     * without it, the history of every resource of the type, ordered by `_recorded` then `_uuid` then version.
     * @param {Object} params
     * @param {string} params.resourceType
     * @param {string} [params.uuid] resource `_uuid`; omit for a type-level read
     * @param {number} params.limit page size
     * @param {string} [params.cursor] token from the previous page
     * @return {Promise<{entries: Object[], nextCursor: string|null}>}
     */
    async findPageAsync({ resourceType, uuid, limit, cursor }) {
        assertIsValid(resourceType, 'resourceType is required');
        assertIsValid(Number.isInteger(limit) && limit > 0, 'limit must be a positive integer');
        const typeLevel = !uuid;
        const position = cursor ? HistoryClickHouseRepository.decodeCursor(cursor) : null;
        if (position && typeLevel && !position.uuid) {
            throw new BadRequestError(new Error('_historyCursor is not valid'));
        }

        const keyColumns = typeLevel
            ? '(_recorded, _uuid, toUInt64OrZero(version_id))'
            : '(_recorded, toUInt64OrZero(version_id))';
        const keyValues = typeLevel
            ? '(fromUnixTimestamp64Milli({recorded_ms:Int64}, \'UTC\'), {cursor_uuid:String}, {version_number:UInt64})'
            : '(fromUnixTimestamp64Milli({recorded_ms:Int64}, \'UTC\'), {version_number:UInt64})';
        const query = `
            SELECT
                raw,
                _uuid AS row_uuid,
                toUnixTimestamp64Milli(_recorded) AS recorded_ms,
                toUInt64OrZero(version_id) AS version_number
            FROM ${TABLES.RESOURCE_HISTORY} FINAL
            WHERE resource_type = {resource_type:String}
              ${typeLevel ? '' : 'AND _uuid = {uuid:String}'}
              ${position ? `AND ${keyColumns} < ${keyValues}` : ''}
            ORDER BY _recorded DESC, ${typeLevel ? '_uuid DESC, ' : ''}toUInt64OrZero(version_id) DESC
            LIMIT {limit:UInt32}
        `;
        const rows = await this._runAsync({
            resourceType,
            query,
            query_params: {
                resource_type: resourceType,
                ...(typeLevel ? {} : { uuid }),
                limit: limit + 1,
                ...(position
                    ? {
                        recorded_ms: position.recordedMs,
                        version_number: position.versionNumber,
                        ...(typeLevel ? { cursor_uuid: position.uuid } : {})
                    }
                    : {})
            }
        });

        const page = rows.slice(0, limit);
        const last = page[page.length - 1];
        return {
            entries: page.map((row) => HistoryClickHouseRepository._parseRaw(row.raw)),
            nextCursor: rows.length > limit
                ? HistoryClickHouseRepository.encodeCursor({
                    recordedMs: Number(last.recorded_ms),
                    versionNumber: Number(last.version_number),
                    ...(typeLevel ? { uuid: String(last.row_uuid) } : {})
                })
                : null
        };
    }

    /**
     * Returns one version of a resource, or null when it is not in ClickHouse.
     * @param {Object} params
     * @param {string} params.resourceType
     * @param {string} params.uuid
     * @param {string} params.versionId
     * @return {Promise<Object|null>}
     */
    async findVersionAsync({ resourceType, uuid, versionId }) {
        assertIsValid(resourceType && uuid && versionId, 'resourceType, _uuid and versionId are required');
        const query = `
            SELECT raw
            FROM ${TABLES.RESOURCE_HISTORY} FINAL
            WHERE resource_type = {resource_type:String}
              AND _uuid = {uuid:String}
              AND version_id = {version_id:String}
            ORDER BY _recorded DESC
            LIMIT 1
        `;
        const rows = await this._runAsync({
            resourceType,
            query,
            query_params: { resource_type: resourceType, uuid, version_id: versionId }
        });
        return rows.length > 0 ? HistoryClickHouseRepository._parseRaw(rows[0].raw) : null;
    }

    /**
     * Runs a query with the history read timeout; records metrics and logs without any payload or id.
     * Any failure surfaces as a 500 (no fallback to MongoDB).
     * @private
     */
    async _runAsync({ resourceType, query, query_params }) {
        const start = Date.now();
        try {
            const rows = await this.clickHouseClientManager.queryAsync({
                query,
                query_params,
                // JSON integer paths are Int64, which ClickHouse quotes by default; FHIR integers must stay numbers
                clickhouse_settings: { output_format_json_quote_64bit_integers: 0 }
            });
            const seconds = (Date.now() - start) / 1000;
            metrics.recordHistoryClickHouseRead(resourceType, true, rows.length, seconds);
            logDebug('ClickHouse history read', { resourceType, rows: rows.length, seconds });
            return rows;
        } catch (error) {
            const seconds = (Date.now() - start) / 1000;
            metrics.recordHistoryClickHouseRead(resourceType, false, 0, seconds);
            logError('ClickHouse history read failed', { resourceType, seconds, error: error.message });
            throw new RethrownError({ message: 'Error reading history from ClickHouse', error });
        }
    }

    /**
     * The JSON column normally arrives as an object; accept a JSON string too.
     * @private
     */
    static _parseRaw(raw) {
        return typeof raw === 'string' ? JSON.parse(raw) : raw;
    }
}

module.exports = {
    HistoryClickHouseRepository
};
