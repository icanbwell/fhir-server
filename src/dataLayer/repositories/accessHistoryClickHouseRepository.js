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

        // Distinct events are counted per entity_ref, then summed. Merging the event sets
        // across entity_refs instead would count an event that read N refs once per query,
        // and the caller sums over entityRefs batches, so totals would depend on batch size.
        const query = `
            SELECT
                accessor_uuid,
                entity_resource_type,
                sum(ref_access_count) AS access_count,
                max(ref_last_accessed) AS last_accessed,
                groupUniqArrayArray(ref_purposes) AS purposes
            FROM (
                SELECT
                    agent_requestor_who AS accessor_uuid,
                    entity_resource_type,
                    entity_ref,
                    uniqExactMerge(access_count) AS ref_access_count,
                    maxMerge(last_accessed) AS ref_last_accessed,
                    groupUniqArrayMerge(purpose_of_events) AS ref_purposes
                FROM ${TABLES.AUDIT_ACCESS_AGG}
                WHERE entity_ref IN {entity_refs:Array(String)}
                AND recorded_date >= toDate(now('UTC') - INTERVAL ${ACCESS_HISTORY_WINDOW_DAYS} DAY)
                GROUP BY accessor_uuid, entity_resource_type, entity_ref
            )
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
