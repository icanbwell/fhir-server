'use strict';

const path = require('path');
const fs = require('fs');

process.env.ENABLE_CLICKHOUSE = '1';
process.env.CLICKHOUSE_HOST = process.env.CLICKHOUSE_HOST || 'http://localhost';
process.env.CLICKHOUSE_PORT = process.env.CLICKHOUSE_PORT || '8123';
process.env.CLICKHOUSE_DATABASE = 'fhir';
process.env.LOGLEVEL = 'SILENT';
process.env.STREAM_RESPONSE = '0';

const { commonBeforeEach, commonAfterEach } = require('../../common');
const { ClickHouseClientManager } = require('../../../utils/clickHouseClientManager');
const { ConfigManager } = require('../../../utils/configManager');
const { TABLES } = require('../../../constants/clickHouseConstants');

const ACCESS_HISTORY_SCHEMA_PATH = path.join(__dirname, '../../../../clickhouse-init/05-audit-access-mv.sql');

let sharedClickHouseManager = null;
let isSetupComplete = false;
let setupPromise = null;

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

async function loadAccessHistorySchema(manager) {
    const tableExists = await manager.tableExistsAsync('AUDIT_ACCESS_AGG');
    if (!tableExists) {
        const schemaSQL = fs.readFileSync(ACCESS_HISTORY_SCHEMA_PATH, 'utf8');
        const statements = schemaSQL
            .split(';')
            .map(s => s.replace(/--.*$/gm, '').trim())
            .filter(s => s.length > 0);

        for (const stmt of statements) {
            await manager.queryAsync({ query: stmt });
        }
    }
}

async function setupAccessHistoryTests() {
    if (setupPromise) return setupPromise;
    if (isSetupComplete) return;

    setupPromise = (async () => {
        try {
            await commonBeforeEach();

            const configManager = new ConfigManager();
            sharedClickHouseManager = new ClickHouseClientManager({ configManager });
            await waitForClickHouse(sharedClickHouseManager, 30000);

            await loadAccessHistorySchema(sharedClickHouseManager);

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

        await commonAfterEach();
        isSetupComplete = false;
        setupPromise = null;
    } catch (error) {
        console.error('Error during teardown:', error);
        throw error;
    }
}

async function cleanupBetweenTests() {
    await commonBeforeEach();
    if (sharedClickHouseManager) {
        try {
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

function getClickHouseManager() { return sharedClickHouseManager; }

module.exports = {
    setupAccessHistoryTests,
    teardownAccessHistoryTests,
    cleanupBetweenTests,
    insertAggRows,
    getClickHouseManager
};
