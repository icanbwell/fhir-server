'use strict';

const path = require('path');
const fs = require('fs');

// Set env vars FIRST, before any requires that trigger DI container creation.
process.env.ENABLE_CLICKHOUSE = '1';
process.env.ENABLE_ACCESS_LOGS_CLICKHOUSE = '1';
process.env.CLICKHOUSE_DATABASE = 'fhir';
process.env.LOGLEVEL = 'SILENT';
process.env.STREAM_RESPONSE = '0';

const {
    commonBeforeEach,
    commonAfterEach,
    createTestRequest,
    getJsonHeadersWithAdminToken,
    getHeadersWithCustomPayload
} = require('../../common');
const { ClickHouseClientManager } = require('../../../utils/clickHouseClientManager');
const { ConfigManager } = require('../../../utils/configManager');
const { ClickHouseTestContainer } = require('../../clickHouseTestContainer');

const ACCESS_LOG_SCHEMA_PATH = path.join(__dirname, '../../../../clickhouse-init/04-access-log.sql');

let sharedRequest = null;
let sharedClickHouseManager = null;
let isSetupComplete = false;
let setupPromise = null;
let clickHouseTestContainer = null;
let savedContainerEnvVars = null;

async function waitForClickHouse (manager, maxWaitMs = 30000) {
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

async function loadAccessLogSchema (manager) {
    const tableExists = await manager.tableExistsAsync('AccessLog');
    if (!tableExists) {
        const schemaSQL = fs.readFileSync(ACCESS_LOG_SCHEMA_PATH, 'utf8');
        const statements = schemaSQL
            .split(';')
            .map(s => s.replace(/--.*$/gm, '').trim())
            .filter(s => s.length > 0);

        for (const stmt of statements) {
            await manager.queryAsync({ query: stmt });
        }
    }
}

async function setupAccessLogClickHouseTests () {
    if (setupPromise) return setupPromise;
    if (isSetupComplete) return;

    setupPromise = (async () => {
        try {
            if (!clickHouseTestContainer) {
                clickHouseTestContainer = new ClickHouseTestContainer();
                await clickHouseTestContainer.start({ startupTimeoutMs: 60000 });
                savedContainerEnvVars = clickHouseTestContainer.applyEnvVars();
            }

            await commonBeforeEach();

            const configManager = new ConfigManager();
            sharedClickHouseManager = new ClickHouseClientManager({ configManager });
            await waitForClickHouse(sharedClickHouseManager, 30000);

            await loadAccessLogSchema(sharedClickHouseManager);

            sharedRequest = await createTestRequest();

            isSetupComplete = true;
        } catch (error) {
            setupPromise = null;
            throw error;
        }
    })();

    return setupPromise;
}

async function teardownAccessLogClickHouseTests () {
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

        await commonAfterEach();
        sharedRequest = null;
        isSetupComplete = false;
        setupPromise = null;
    } catch (error) {
        console.error('Error during teardown:', error);
        throw error;
    }
}

async function cleanupBetweenTests () {
    await commonBeforeEach();
    if (sharedClickHouseManager) {
        try {
            await sharedClickHouseManager.queryAsync({
                query: 'TRUNCATE TABLE IF EXISTS fhir.AccessLog'
            });
        } catch (e) {
            // ignore
        }
    }
}

// AccessLog has a 7-day TTL. Default timestamps must fall inside that window
// (roughly "now"), or ClickHouse will delete the rows before the test reads them.
function recentTimestamp (offsetMinutes = 0) {
    const d = new Date(Date.now() - offsetMinutes * 60 * 1000);
    return d.toISOString().replace('T', ' ').replace('Z', '');
}

function makeAccessLog (overrides = {}) {
    const requestId = overrides.requestId || `req-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const timestamp = overrides.timestamp || recentTimestamp();
    const outcomeDesc = overrides.outcomeDesc || 'Success';

    return {
        timestamp,
        outcome_desc: outcomeDesc,
        agent: overrides.agent || {
            altId: 'user-1',
            networkAddress: '10.0.0.1',
            scopes: ['user/*.read', 'user/*.write']
        },
        details: overrides.details || {
            host: 'fhir.example.com',
            originService: 'patient-portal',
            contentType: 'application/fhir+json',
            accept: 'application/fhir+json'
        },
        request: overrides.request || {
            id: requestId,
            systemGeneratedRequestId: `sys-${requestId}`,
            url: '/4_0_0/Patient/123',
            resourceType: 'Patient',
            operation: 'READ',
            method: 'GET',
            duration: 42
        }
    };
}

async function insertRows (rows) {
    await sharedClickHouseManager.insertAsync({
        table: 'fhir.AccessLog',
        values: rows,
        format: 'JSONEachRow'
    });
}

function getSharedRequest () { return sharedRequest; }
function getClickHouseManager () { return sharedClickHouseManager; }
function getAdminHeaders () { return getJsonHeadersWithAdminToken(); }
function getHeadersWithPayload (payload) { return getHeadersWithCustomPayload(payload); }

module.exports = {
    setupAccessLogClickHouseTests,
    teardownAccessLogClickHouseTests,
    cleanupBetweenTests,
    getSharedRequest,
    getClickHouseManager,
    getAdminHeaders,
    getHeadersWithPayload,
    makeAccessLog,
    recentTimestamp,
    insertRows
};
