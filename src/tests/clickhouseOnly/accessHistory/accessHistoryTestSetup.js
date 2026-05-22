'use strict';

const path = require('path');
const fs = require('fs');

process.env.ENABLE_CLICKHOUSE = '1';
process.env.CLICKHOUSE_DATABASE = 'fhir';
process.env.CLICKHOUSE_ONLY_RESOURCES = 'AuditEvent';

const { ClickHouseClientManager } = require('../../../utils/clickHouseClientManager');
const { ConfigManager } = require('../../../utils/configManager');
const { ClickHouseTestContainer } = require('../../clickHouseTestContainer');
const { TABLES } = require('../../../constants/clickHouseConstants');

const AUDIT_EVENT_SCHEMA_PATH = path.join(__dirname, '../../../../clickhouse-init/02-audit-event.sql');
const ACCESS_HISTORY_SCHEMA_PATH = path.join(__dirname, '../../../../clickhouse-init/05-audit-access-mv.sql');

let sharedClickHouseManager = null;
let isSetupComplete = false;
let setupPromise = null;
let clickHouseTestContainer = null;
let savedContainerEnvVars = null;

async function waitForClickHouse(manager, maxWaitMs = 30000) {
    const startTime = Date.now();
    let delay = 100;

    while (Date.now() - startTime < maxWaitMs) {
        try {
            await manager.getClientAsync();
            const isHealthy = await manager.isHealthyAsync();
            if (isHealthy) return true;
        } catch (e) {
            // retry
        }
        await new Promise(resolve => setTimeout(resolve, delay));
        delay = Math.min(delay * 2, 1000);
    }
    throw new Error(`ClickHouse not ready after ${maxWaitMs}ms`);
}

async function loadSchemaAlways(manager, schemaPath) {
    const schemaSQL = fs.readFileSync(schemaPath, 'utf8');
    const statements = schemaSQL
        .split(';')
        .map(s => s.replace(/--.*$/gm, '').trim())
        .filter(s => s.length > 0);

    for (const stmt of statements) {
        await manager.queryAsync({ query: stmt });
    }
}

async function setupAccessHistoryTests() {
    if (setupPromise) return setupPromise;
    if (isSetupComplete) return;

    setupPromise = (async () => {
        try {
            if (!clickHouseTestContainer) {
                clickHouseTestContainer = new ClickHouseTestContainer();
                await clickHouseTestContainer.start({ startupTimeoutMs: 60000 });
                savedContainerEnvVars = clickHouseTestContainer.applyEnvVars();
            }

            const configManager = new ConfigManager();
            sharedClickHouseManager = new ClickHouseClientManager({ configManager });
            await waitForClickHouse(sharedClickHouseManager, 30000);

            // Always load schemas with IF NOT EXISTS — safe to re-run
            await loadSchemaAlways(sharedClickHouseManager, AUDIT_EVENT_SCHEMA_PATH);
            await loadSchemaAlways(sharedClickHouseManager, ACCESS_HISTORY_SCHEMA_PATH);

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

        if (clickHouseTestContainer) {
            if (savedContainerEnvVars) {
                clickHouseTestContainer.restoreEnvVars(savedContainerEnvVars);
                savedContainerEnvVars = null;
            }
            await clickHouseTestContainer.stop();
            clickHouseTestContainer = null;
        }

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
                query: `TRUNCATE TABLE IF EXISTS ${TABLES.AUDIT_EVENT}`
            });
            await sharedClickHouseManager.queryAsync({
                query: `TRUNCATE TABLE IF EXISTS ${TABLES.AUDIT_ACCESS_AGG}`
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
