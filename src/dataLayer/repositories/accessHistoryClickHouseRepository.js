const { TABLES, ACCESS_HISTORY_WINDOW_DAYS } = require('../../constants/clickHouseConstants');
const { assertIsValid } = require('../../utils/assertType');

class AccessHistoryClickHouseRepository {
    /**
     * @param {Object} params
     * @param {import('../../utils/clickHouseClientManager').ClickHouseClientManager} params.clickHouseClientManager
     */
    constructor({ clickHouseClientManager }) {
        this.clickHouseClientManager = clickHouseClientManager;
    }

    /**
     * Queries the AUDIT_ACCESS_AGG table for access history of one or more entities.
     * @param {Object} params
     * @param {string[]} params.entityRefs - e.g. ['Patient/123', 'Patient/456']
     * @returns {Promise<{rows: Object[]}>}
     */
    async getAccessHistoryAsync({ entityRefs }) {
        assertIsValid(Array.isArray(entityRefs) && entityRefs.length > 0, 'entityRefs must be a non-empty array');

        const query = `
            SELECT
                agent_requestor_who AS accessor_uuid,
                entity_resource_type,
                countMerge(access_count) AS access_count,
                maxMerge(last_accessed) AS last_accessed,
                groupUniqArrayMerge(purpose_of_events) AS purposes
            FROM ${TABLES.AUDIT_ACCESS_AGG}
            WHERE entity_ref IN {entity_refs:Array(String)}
            AND recorded_month >= toStartOfMonth(now() - INTERVAL ${ACCESS_HISTORY_WINDOW_DAYS} DAY)
            GROUP BY accessor_uuid, entity_resource_type
            ORDER BY last_accessed DESC
        `;

        const rows = await this.clickHouseClientManager.queryAsync({
            query,
            query_params: {
                entity_refs: entityRefs
            }
        });

        return { rows };
    }
}

module.exports = { AccessHistoryClickHouseRepository };
