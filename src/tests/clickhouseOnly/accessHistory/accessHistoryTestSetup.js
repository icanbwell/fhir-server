'use strict';

process.env.ENABLE_CLICKHOUSE = '1';
process.env.CLICKHOUSE_DATABASE = 'fhir';

const { ClickHouseClientManager } = require('../../../utils/clickHouseClientManager');
const { ConfigManager } = require('../../../utils/configManager');
const { TABLES } = require('../../../constants/clickHouseConstants');

let sharedClickHouseManager = null;
let isSetupComplete = false;
let setupPromise = null;

async function setupAccessHistoryTests() {
    if (setupPromise) return setupPromise;
    if (isSetupComplete) return;

    setupPromise = (async () => {
        try {
            // ClickHouse container is started and the AuditEvent + AccessHistory
            // schemas are loaded by jestGlobalSetup; just create a manager.
            const configManager = new ConfigManager();
            sharedClickHouseManager = new ClickHouseClientManager({ configManager });

            isSetupComplete = true;
        } catch (error) {
            setupPromise = null;
            throw error;
        }
    })();

    return setupPromise;
}

async function teardownAccessHistoryTests() {
    if (!isSetupComplete) return;

    try {
        if (sharedClickHouseManager) {
            await sharedClickHouseManager.closeAsync();
            sharedClickHouseManager = null;
        }

        // ClickHouse container is stopped once by jestGlobalTeardown.

        isSetupComplete = false;
        setupPromise = null;
    } catch (error) {
        console.error('Error during teardown:', error);
        throw error;
    }
}

async function cleanupBetweenTests() {
    if (sharedClickHouseManager) {
        try {
            await sharedClickHouseManager.queryAsync({
                query: `TRUNCATE TABLE IF EXISTS ${TABLES.AUDIT_ACCESS_AGG}`
            });
            await sharedClickHouseManager.queryAsync({
                query: `TRUNCATE TABLE IF EXISTS ${TABLES.AUDIT_EVENT}`
            });
        } catch (e) {
            // ignore
        }
    }
}

async function insertAggRows(rows) {
    for (const row of rows) {
        await sharedClickHouseManager.queryAsync({
            query: `
                INSERT INTO ${TABLES.AUDIT_ACCESS_AGG}
                SELECT
                    {entity_ref:String} AS entity_ref,
                    {agent_requestor_who:String} AS agent_requestor_who,
                    {entity_resource_type:String} AS entity_resource_type,
                    toDateTime({recorded_month:String}) AS recorded_month,
                    countState() AS access_count,
                    maxState(toDateTime64({last_accessed:String}, 3, 'UTC')) AS last_accessed,
                    groupUniqArrayState({purpose:String}) AS purpose_of_events
            `,
            query_params: {
                entity_ref: row.entity_ref,
                agent_requestor_who: row.agent_requestor_who,
                entity_resource_type: row.entity_resource_type,
                recorded_month: row.recorded_month,
                last_accessed: row.last_accessed,
                purpose: row.purpose || ''
            }
        });
    }
}

async function insertAuditEvents(events) {
    for (const event of events) {
        const purposeTuples = (event.purpose_of_event || [])
            .map(p => `('${p.system}', '${p.code}')`)
            .join(', ');
        const purposeExpr = purposeTuples ? `[${purposeTuples}]` : '[]::Array(Tuple(system LowCardinality(String), code LowCardinality(String)))';

        const entityItems = (event.entity_what || [])
            .map(e => `'${e}'`)
            .join(', ');
        const entityExpr = `[${entityItems}]`;

        const id = event.id || `audit-${Date.now()}-${Math.random().toString(36).slice(2)}`;

        await sharedClickHouseManager.queryAsync({
            query: `
                INSERT INTO ${TABLES.AUDIT_EVENT}
                SELECT
                    {id:String} AS id,
                    {uuid:String} AS _uuid,
                    toDateTime64({recorded:String}, 3, 'UTC') AS recorded,
                    {action:String} AS action,
                    [{agent_who:String}] AS agent_who,
                    []::Array(String) AS agent_altid,
                    ${entityExpr} AS entity_what,
                    {agent_requestor_who:String} AS agent_requestor_who,
                    ${purposeExpr} AS purpose_of_event,
                    []::Array(Tuple(system LowCardinality(String), code LowCardinality(String))) AS meta_security,
                    []::Array(String) AS access_tags,
                    '' AS _sourceAssigningAuthority,
                    {id:String} AS _sourceId,
                    '{}' AS resource
            `,
            query_params: {
                id,
                uuid: event.uuid || `uuid-${Date.now()}-${Math.random().toString(36).slice(2)}`,
                recorded: event.recorded,
                action: event.action || 'R',
                agent_who: event.agent_requestor_who,
                agent_requestor_who: event.agent_requestor_who
            }
        });
    }
}

function getClickHouseManager() { return sharedClickHouseManager; }

module.exports = {
    setupAccessHistoryTests,
    teardownAccessHistoryTests,
    cleanupBetweenTests,
    insertAggRows,
    insertAuditEvents,
    getClickHouseManager
};
