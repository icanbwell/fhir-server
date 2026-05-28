'use strict';

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

let sharedRequest = null;
let sharedClickHouseManager = null;
let isSetupComplete = false;
let setupPromise = null;

async function setupAccessLogClickHouseTests () {
    if (setupPromise) return setupPromise;
    if (isSetupComplete) return;

    setupPromise = (async () => {
        try {
            await commonBeforeEach();

            // ClickHouse container is started and the AccessLog schema is loaded
            // by jestGlobalSetup; just create a manager pointed at it.
            const configManager = new ConfigManager();
            sharedClickHouseManager = new ClickHouseClientManager({ configManager });

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
