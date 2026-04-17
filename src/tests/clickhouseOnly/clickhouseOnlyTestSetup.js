'use strict';

const path = require('path');
const fs = require('fs');
const { commonBeforeEach, commonAfterEach, createTestRequest, getHeaders } = require('../common');
const { ClickHouseSchemaRegistry } = require('../../dataLayer/clickHouse/schemaRegistry');
const { ScaffoldingTestFieldExtractor } = require('./scaffoldingTestFieldExtractor');
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
process.env.CLICKHOUSE_ONLY_RESOURCES = 'ScaffoldingTestResource';
process.env.CLICKHOUSE_DATABASE = 'fhir';
process.env.LOGLEVEL = 'SILENT';
process.env.STREAM_RESPONSE = '0';

const TEST_SCHEMA_PATH = path.join(__dirname, 'test-schema.sql');

// Shared singleton instances
let sharedRequest = null;
let sharedClickHouseManager = null;
let schemaRegistry = null;
let isSetupComplete = false;
let setupPromise = null;
let clickHouseTestContainer = null;
let savedContainerEnvVars = null;

/**
 * ScaffoldingTestResource schema definition.
 */
function getTestSchema () {
    return {
        resourceType: 'ScaffoldingTestResource',
        tableName: 'fhir.fhir_scaffolding_test',
        engine: ENGINE_TYPES.MERGE_TREE,
        versionColumn: null,
        dedupKey: null,
        seekKey: ['recorded', 'id'],
        fhirResourceColumn: '_fhir_resource',
        fhirResourceColumnType: RESOURCE_COLUMN_TYPES.STRING,
        fieldMappings: {
            recorded: { column: 'recorded', type: 'datetime' },
            type_code: { column: 'type_code', type: 'lowcardinality' },
            subject_reference: { column: 'subject_reference', type: 'reference' },
            status: { column: 'status', type: 'lowcardinality' },
            value_quantity: { column: 'value_quantity', type: 'number' }
        },
        securityMappings: {
            accessTags: 'access_tags',
            sourceAssigningAuthority: 'source_assigning_authority'
        },
        requiredFilters: [],
        maxRangeDays: null,
        writeStrategy: WRITE_STRATEGIES.SYNC_DIRECT,
        fireChangeEvents: false,
        fieldExtractor: new ScaffoldingTestFieldExtractor()
    };
}

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
 * Loads the test schema SQL into ClickHouse.
 */
async function initializeTestSchema (manager) {
    const exists = await manager.tableExistsAsync('fhir_scaffolding_test');
    if (!exists) {
        const schemaSQL = fs.readFileSync(TEST_SCHEMA_PATH, 'utf8');
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
 * Sets up integration test infrastructure.
 * Uses ClickHouseTestContainer (same pattern as Group tests).
 */
async function setupClickHouseOnlyTests () {
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

            // Load test schema (additional to 01-init-schema.sql which is loaded by the container)
            await initializeTestSchema(sharedClickHouseManager);

            // Register test schema
            schemaRegistry = new ClickHouseSchemaRegistry();
            schemaRegistry.registerSchema('ScaffoldingTestResource', getTestSchema());

            isSetupComplete = true;
        } catch (error) {
            setupPromise = null;
            throw error;
        }
    })();

    return setupPromise;
}

async function teardownClickHouseOnlyTests () {
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
        console.error('Error during teardown:', error);
        throw error;
    }
}

async function cleanupBetweenTests () {
    await commonBeforeEach();
    if (sharedClickHouseManager) {
        try {
            await sharedClickHouseManager.queryAsync({
                query: 'TRUNCATE TABLE IF EXISTS fhir.fhir_scaffolding_test'
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
    setupClickHouseOnlyTests,
    teardownClickHouseOnlyTests,
    cleanupBetweenTests,
    getSharedRequest,
    getClickHouseManager,
    getSchemaRegistry,
    getTestHeaders,
    getTestSchema
};
