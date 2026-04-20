const { logError } = require('../operations/common/logging');
const { assertTypeEquals } = require('../utils/assertType');
const { ClickHouseClientManager } = require('../utils/clickHouseClientManager');
const { TABLES } = require('../constants/clickHouseConstants');

/**
 * Admin-side reader for access-logs stored in ClickHouse.
 *
 * Mirrors AdminLogManager's `getLogAsync(id)` contract but reads directly
 * from fhir.AccessLog via a parameterized SQL query. AccessLog is not a
 * FHIR resource, so it bypasses the generic scaffolding (schema registry,
 * query parser, query builder) used for AuditEvent.
 *
 * The row shape stored in ClickHouse is reassembled into the same
 * { timestamp, outcomeDesc, agent, details, request } envelope the Mongo
 * path returns, so the admin endpoint's response shape is unchanged
 * regardless of backend.
 */
class AdminAccessLogClickHouseManager {
    /**
     * @param {Object} params
     * @param {ClickHouseClientManager} params.clickHouseClientManager
     */
    constructor ({ clickHouseClientManager }) {
        this.clickHouseClientManager = clickHouseClientManager;
        assertTypeEquals(clickHouseClientManager, ClickHouseClientManager);
    }

    /**
     * Returns access-log rows for the given request id, in the same envelope
     * shape AccessLogger emits and AdminLogManager.getLogAsync returns.
     *
     * The request_id bloom-filter skip-index prunes granules on equality
     * lookups; the 7-day TTL caps scanned data. Returns [] on error so the
     * admin UI doesn't crash when CH is briefly unavailable.
     *
     * @param {string} id - user request id (stored as request.id / request_id)
     * @returns {Promise<Object[]>}
     */
    async getLogAsync (id) {
        try {
            const rows = await this.clickHouseClientManager.queryAsync({
                query: `SELECT timestamp, outcome_desc, agent, details, request
                        FROM ${TABLES.ACCESS_LOG}
                        WHERE request_id = {id:String}
                        ORDER BY timestamp DESC
                        LIMIT 100`,
                query_params: { id }
            });

            return rows.map((row) => ({
                timestamp: row.timestamp,
                outcomeDesc: row.outcome_desc,
                agent: row.agent,
                details: row.details,
                request: row.request
            }));
        } catch (e) {
            logError(e.message, { error: e });
        }
        return [];
    }
}

module.exports = {
    AdminAccessLogClickHouseManager
};
