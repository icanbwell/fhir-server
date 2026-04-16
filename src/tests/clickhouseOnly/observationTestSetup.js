'use strict';

const path = require('path');
const fs = require('fs');
const { commonBeforeEach, commonAfterEach, createTestRequest, getHeaders } = require('../common');
const { ClickHouseSchemaRegistry } = require('../../dataLayer/clickHouse/schemaRegistry');
const { getObservationSchema } = require('../../dataLayer/clickHouse/schemas/observationSchema');
const {
    WRITE_STRATEGIES,
    ENGINE_TYPES,
    RESOURCE_COLUMN_TYPES
} = require('../../constants/clickHouseConstants');
const { ConfigManager } = require('../../utils/configManager');
const { ClickHouseClientManager } = require('../../utils/clickHouseClientManager');
const { ClickHouseTestContainer } = require('../clickHouseTestContainer');

// Set env vars FIRST, before any requires
process.env.ENABLE_CLICKHOUSE = '1';
process.env.CLICKHOUSE_ONLY_RESOURCES = 'Observation';
process.env.CLICKHOUSE_DATABASE = 'fhir';
process.env.LOGLEVEL = 'SILENT';
process.env.STREAM_RESPONSE = '0';

const OBSERVATION_SCHEMA_PATH = path.join(__dirname, '../../..', 'clickhouse-init/04-observations.sql');

// Shared singleton instances
let sharedRequest = null;
let sharedClickHouseManager = null;
let schemaRegistry = null;
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

/**
 * Loads the Observation DDL SQL into ClickHouse.
 */
async function initializeObservationSchema (manager) {
    const exists = await manager.tableExistsAsync('Observation_4_0_0');
    if (!exists) {
        const schemaSQL = fs.readFileSync(OBSERVATION_SCHEMA_PATH, 'utf8');
        const statements = schemaSQL
            .split(';')
            .map(s => s.replace(/--.*$/gm, '').trim())
            .filter(s => s.length > 0);

        for (const stmt of statements) {
            await manager.queryAsync({ query: stmt });
        }
    }
}

/**
 * Sets up integration test infrastructure for Observation tests.
 * Uses ClickHouseTestContainer (same pattern as ScaffoldingTestResource tests).
 */
async function setupObservationTests () {
    if (setupPromise) return setupPromise;
    if (isSetupComplete) return;

    setupPromise = (async () => {
        try {
            // Start ClickHouse test container
            if (!clickHouseTestContainer) {
                clickHouseTestContainer = new ClickHouseTestContainer();
                await clickHouseTestContainer.start({ startupTimeoutMs: 60000 });
                savedContainerEnvVars = clickHouseTestContainer.applyEnvVars();
            }

            // Initialize common test infrastructure
            await commonBeforeEach();
            sharedRequest = await createTestRequest();

            // Create ClickHouse manager
            const configManager = new ConfigManager();
            sharedClickHouseManager = new ClickHouseClientManager({ configManager });
            await waitForClickHouse(sharedClickHouseManager, 30000);

            // Load Observation DDL (01-init-schema.sql is loaded by the container entrypoint)
            await initializeObservationSchema(sharedClickHouseManager);

            // Register Observation schema
            schemaRegistry = new ClickHouseSchemaRegistry();
            schemaRegistry.registerSchema('Observation', getObservationSchema());

            isSetupComplete = true;
        } catch (error) {
            setupPromise = null;
            throw error;
        }
    })();

    return setupPromise;
}

async function teardownObservationTests () {
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
        schemaRegistry = null;
        isSetupComplete = false;
        setupPromise = null;
    } catch (error) {
        console.error('Error during Observation test teardown:', error);
        throw error;
    }
}

async function cleanupBetweenTests () {
    await commonBeforeEach();
    if (sharedClickHouseManager) {
        try {
            await sharedClickHouseManager.queryAsync({
                query: 'TRUNCATE TABLE IF EXISTS fhir.Observation_4_0_0'
            });
        } catch (e) {
            // ignore
        }
    }
}

function getSharedRequest () { return sharedRequest; }
function getClickHouseManager () { return sharedClickHouseManager; }
function getSchemaRegistry () { return schemaRegistry; }
function getTestHeaders (scope) { return getHeaders(scope); }

module.exports = {
    setupObservationTests,
    teardownObservationTests,
    cleanupBetweenTests,
    getSharedRequest,
    getClickHouseManager,
    getSchemaRegistry,
    getTestHeaders
};
