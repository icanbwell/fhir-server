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

/**
 * Loads the test schema SQL into ClickHouse. This schema (ScaffoldingTestResource)
 * is test-only and is not part of the global container's clickhouse-init/ files,
 * so it must be loaded per-setup.
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
 * Uses the shared ClickHouse container started by jestGlobalSetup.
 */
async function setupClickHouseOnlyTests () {
    if (setupPromise) return setupPromise;
    if (isSetupComplete) return;

    setupPromise = (async () => {
        try {
            // ClickHouse container is started once by jestGlobalSetup; CLICKHOUSE_HOST/PORT
            // are inherited via process.env from the parent process.

            // Initialize common test infrastructure
            await commonBeforeEach();
            sharedRequest = await createTestRequest();

            // Create ClickHouse manager pointed at the container started by jestGlobalSetup.
            const configManager = new ConfigManager();
            sharedClickHouseManager = new ClickHouseClientManager({ configManager });

            // Load test-only schema (the global container only has the production
            // clickhouse-init/ files; ScaffoldingTestResource is added here).
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

        // ClickHouse container is stopped once by jestGlobalTeardown.

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
