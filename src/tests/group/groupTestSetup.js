/**
 * Shared test setup for Group tests
 *
 * This module provides a singleton server instance and ClickHouse manager
 * that is reused across all Group tests to avoid expensive setup/teardown
 * per test file.
 *
 * Usage:
 *   const { setupGroupTests, getSharedRequest, getClickHouseManager } = require('./groupTestSetup');
 *
 *   beforeAll(async () => {
 *     await setupGroupTests();
 *   });
 */

const { commonBeforeEach, commonAfterEach, createTestRequest, getHeaders } = require('../common');
const { ConfigManager } = require('../../utils/configManager');
const { ClickHouseClientManager } = require('../../utils/clickHouseClientManager');
const { ensureClickHouse } = require('../ensureClickHouse');
const { USE_EXTERNAL_MEMBER_STORAGE_HEADER } = require('../../utils/contextDataBuilder');

// Set env vars FIRST, before any requires
process.env.ENABLE_CLICKHOUSE = '1';
process.env.MONGO_WITH_CLICKHOUSE_RESOURCES = 'Group';
process.env.CLICKHOUSE_WRITE_MODE = 'sync';
process.env.CLICKHOUSE_DATABASE = 'fhir';
process.env.CLICKHOUSE_HOST = 'localhost'; // GitHub Actions services are accessible via localhost
process.env.CLICKHOUSE_PORT = '8123';
process.env.LOGLEVEL = 'SILENT';
process.env.STREAM_RESPONSE = '0';

// Shared singleton instances
let sharedRequest = null;
let sharedClickHouseManager = null;
let isSetupComplete = false;
let setupPromise = null;

/**
 * Waits for ClickHouse to be ready with exponential backoff
 */
async function waitForClickHouse(manager, maxWaitMs = 30000) {
    const startTime = Date.now();
    let attempt = 0;
    let delay = 100; // Start with 100ms

    while (Date.now() - startTime < maxWaitMs) {
        try {
            attempt++;
            await manager.getClientAsync();
            const isHealthy = await manager.isHealthyAsync();
            if (isHealthy) {
                return true;
            }
        } catch (e) {
            // Silent retry
        }

        // Exponential backoff: 100ms -> 200ms -> 400ms -> 800ms -> 1000ms (cap)
        await new Promise(resolve => setTimeout(resolve, delay));
        delay = Math.min(delay * 2, 1000);
    }

    throw new Error(`ClickHouse not ready after ${maxWaitMs}ms`);
}

/**
 * Initializes ClickHouse schema if needed
 * Uses the full schema from clickhouse-init/01-init-schema.sql
 */
async function initializeClickHouseSchema(clickHouseManager) {
    try {
        const fs = require('fs');
        const path = require('path');

        // Check if schema is already initialized
        const exists = await clickHouseManager.tableExistsAsync('fhir.fhir_group_member_events');

        if (!exists) {
            const schemaPath = path.join(__dirname, '../../..', 'clickhouse-init', '01-init-schema.sql');
            const schemaSQL = fs.readFileSync(schemaPath, 'utf8');

            const statements = schemaSQL
                .split(';')
                .map(s => s.trim())
                .filter(s => s.length > 0 && !s.match(/^--/) && !s.match(/^SET\s+/i))
                .filter(s => !s.includes('ClickHouse FHIR schema initialized'));

            for (const statement of statements) {
                try {
                    await clickHouseManager.queryAsync({ query: statement });
                } catch (err) {
                    if (!err.message.includes('already exists')) {
                        // Ignore other errors during schema init
                    }
                }
            }
        }

        // Apply migration for entity_reference_uuid/source_id columns
        const migrationPath = path.join(__dirname, '../../..', 'clickhouse-init', '02-add-entity-reference-columns.sql');
        if (fs.existsSync(migrationPath)) {
            const migrationSQL = fs.readFileSync(migrationPath, 'utf8');
            const migrationStatements = migrationSQL
                .split(';')
                .map(s => s.trim())
                .filter(s => s.length > 0 && !s.match(/^--/));

            for (const statement of migrationStatements) {
                try {
                    await clickHouseManager.queryAsync({ query: statement });
                } catch (err) {
                    if (!err.message.includes('already exists') && !err.message.includes('duplicate column')) {
                        // Ignore migration errors for idempotency
                    }
                }
            }
        }
    } catch (e) {
        console.error('Error initializing ClickHouse schema:', e.message);
        throw e;
    }
}

/**
 * Sets up shared test infrastructure (call once in beforeAll)
 * Uses singleton pattern to ensure setup only happens once
 *
 * @returns {Promise<void>}
 */
async function setupGroupTests() {
    // If setup is in progress, wait for it
    if (setupPromise) {
        return setupPromise;
    }

    // If already complete, return immediately
    if (isSetupComplete) {
        return;
    }

    // Start setup and store promise
    setupPromise = (async () => {
        try {
            // Initialize common test infrastructure
            await commonBeforeEach();

            // Create shared request (server instance)
            sharedRequest = await createTestRequest();

            // Create shared ClickHouse manager
            const configManager = new ConfigManager();
            sharedClickHouseManager = new ClickHouseClientManager({ configManager });

            // Wait for ClickHouse to be ready
            // In CI, ClickHouse service should be running (GitHub Actions service)
            // Locally, ensureClickHouse() would have started it
            await waitForClickHouse(sharedClickHouseManager, 30000);

            // Initialize schema
            await initializeClickHouseSchema(sharedClickHouseManager);

            isSetupComplete = true;
        } catch (error) {
            setupPromise = null; // Allow retry on failure
            throw error;
        }
    })();

    return setupPromise;
}

/**
 * Tears down shared test infrastructure (call once in afterAll)
 *
 * @returns {Promise<void>}
 */
async function teardownGroupTests() {
    if (!isSetupComplete) {
        return;
    }

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

/**
 * Cleans up a specific group's data from ClickHouse and MongoDB
 *
 * @param {string} groupId - The group ID to clean up
 * @returns {Promise<void>}
 */
async function cleanupGroupData(groupId) {
    if (!sharedClickHouseManager) {
        return;
    }

    try {
        await sharedClickHouseManager.queryAsync({
            query: `ALTER TABLE fhir.fhir_group_member_events DELETE WHERE group_id = {groupId:String}`,
            query_params: { groupId }
        });

        await syncClickHouseMaterializedViews();

        const { createTestContainer } = require('../createTestContainer');
        const container = createTestContainer();
        if (container?.mongoClient) {
            const db = container.mongoClient.db(container.configManager.mongoDbName);
            await db.collection('Group_4_0_0').deleteOne({ id: groupId });
        }
    } catch (e) {
        if (!e.message.includes('does not exist')) {
            // Ignore cleanup errors
        }
    }
}

/**
 * Truncates all Group test data from ClickHouse and MongoDB
 *
 * @returns {Promise<void>}
 */
async function cleanupAllData() {
    if (!sharedClickHouseManager) {
        return;
    }

    try {
        await sharedClickHouseManager.truncateTableAsync('fhir_group_member_current_by_entity');
        await sharedClickHouseManager.truncateTableAsync('fhir_group_member_current');
        await sharedClickHouseManager.truncateTableAsync('fhir_group_member_events');

        await syncClickHouseMaterializedViews();
        await new Promise(resolve => setTimeout(resolve, 100));

        const { createTestContainer } = require('../createTestContainer');
        const container = createTestContainer();
        if (container?.mongoClient) {
            const db = container.mongoClient.db(container.configManager.mongoDbName);
            await db.collection('Group_4_0_0').deleteMany({});
        }
    } catch (e) {
        if (!e.message.includes('does not exist')) {
            // Ignore cleanup errors
        }
    }
}

/**
 * Cleans up test data between tests
 * @deprecated Use cleanupAllData() or cleanupGroupData(groupId)
 *
 * @returns {Promise<void>}
 */
async function cleanupBetweenTests() {
    return cleanupAllData();
}

/**
 * Smart wait for ClickHouse data to be available with exponential backoff
 * Replaces fixed setTimeout calls with adaptive polling
 *
 * @param {Function} checkFn - Async function that returns true when data is ready
 * @param {Object} options
 * @param {number} options.timeout - Maximum time to wait in ms (default: 5000)
 * @param {number} options.initialDelay - Initial delay in ms (default: 50)
 * @param {number} options.maxDelay - Maximum delay between attempts in ms (default: 500)
 * @param {string} options.description - Description for error message
 * @returns {Promise<void>}
 */
async function waitForData(checkFn, options = {}) {
    const {
        timeout = 5000,
        initialDelay = 50,
        maxDelay = 500,
        description = 'data to be available'
    } = options;

    const startTime = Date.now();
    let delay = initialDelay;
    let lastError;

    while (Date.now() - startTime < timeout) {
        try {
            const result = await checkFn();
            if (result) {
                return;
            }
        } catch (error) {
            lastError = error;
        }

        await new Promise(resolve => setTimeout(resolve, delay));
        delay = Math.min(delay * 1.5, maxDelay);
    }

    const elapsed = Date.now() - startTime;
    const errorMsg = lastError ? ` Last error: ${lastError.message}` : '';
    throw new Error(`Timeout waiting for ${description} after ${elapsed}ms.${errorMsg}`);
}

/**
 * Forces ClickHouse to optimize (merge) table parts and sync materialized views
 * Ensures queries see up-to-date aggregated state
 *
 * OPTIMIZE TABLE FINAL forces immediate merge of all table parts, making data
 * visible in materialized views. This is critical for test reliability because
 * ClickHouse materialized views update asynchronously after inserts.
 *
 * @returns {Promise<void>}
 */
async function syncClickHouseMaterializedViews() {
    if (!sharedClickHouseManager) {
        return;
    }

    try {
        // Force merge of all parts to ensure queries see latest state
        // FINAL keyword forces immediate merge of all parts
        await sharedClickHouseManager.queryAsync({
            query: 'OPTIMIZE TABLE fhir.fhir_group_member_current_by_entity FINAL'
        });

        await sharedClickHouseManager.queryAsync({
            query: 'OPTIMIZE TABLE fhir.fhir_group_member_current FINAL'
        });
    } catch (e) {
        // Ignore optimization errors
    }
}

/**
 * Gets the shared request object (server instance)
 *
 * @returns {Object} SuperTest request object
 * @throws {Error} If setup not complete
 */
function getSharedRequest() {
    if (!sharedRequest) {
        throw new Error('Shared request not initialized. Call setupGroupTests() in beforeAll first.');
    }
    return sharedRequest;
}

/**
 * Gets the shared ClickHouse manager
 *
 * @returns {ClickHouseClientManager}
 * @throws {Error} If setup not complete
 */
function getClickHouseManager() {
    if (!sharedClickHouseManager) {
        throw new Error('ClickHouse manager not initialized. Call setupGroupTests() in beforeAll first.');
    }
    return sharedClickHouseManager;
}

/**
 * Helper to get standard headers for requests
 */
function getTestHeaders() {
    return getHeaders();
}

/**
 * Helper to get headers with the useExternalMemberStorage flag enabled
 * Used by tests that exercise ClickHouse member storage paths
 */
function getTestHeadersWithExternalStorage() {
    return {
        ...getHeaders(),
        [USE_EXTERNAL_MEMBER_STORAGE_HEADER]: 'true'
    };
}

module.exports = {
    setupGroupTests,
    teardownGroupTests,
    cleanupBetweenTests,
    cleanupAllData,
    cleanupGroupData,
    syncClickHouseMaterializedViews,
    getSharedRequest,
    getClickHouseManager,
    getTestHeaders,
    getTestHeadersWithExternalStorage,
    waitForData
};
