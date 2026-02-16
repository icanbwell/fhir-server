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

// Set env vars FIRST, before any requires
process.env.ENABLE_CLICKHOUSE = '1';
process.env.MONGO_WITH_CLICKHOUSE_RESOURCES = 'Group';
process.env.CLICKHOUSE_WRITE_MODE = 'sync';
process.env.CLICKHOUSE_DATABASE = 'fhir';
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
 */
async function initializeClickHouseSchema(clickHouseManager) {
    try {
        const exists = await clickHouseManager.tableExistsAsync('fhir.fhir_group_member_events');

        if (!exists) {
            // Create table directly
            const createTableSQL = `
                CREATE TABLE IF NOT EXISTS fhir.fhir_group_member_events (
                    group_id String,
                    entity_reference String,
                    entity_type LowCardinality(String),
                    event_type Enum8('added' = 1, 'removed' = 2),
                    event_time DateTime64(3, 'UTC') DEFAULT now64(3, 'UTC'),
                    event_id UUID DEFAULT generateUUIDv4(),
                    period_start Nullable(DateTime64(3, 'UTC')),
                    period_end Nullable(DateTime64(3, 'UTC')),
                    inactive UInt8 DEFAULT 0,
                    group_source_id String DEFAULT '',
                    group_source_assigning_authority String DEFAULT '',
                    access_tags Array(String) DEFAULT [],
                    owner_tags Array(String) DEFAULT []
                ) ENGINE = MergeTree()
                ORDER BY (group_id, entity_reference, event_time, event_id)
            `;

            await clickHouseManager.queryAsync({ query: createTableSQL });
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
            // Ensure ClickHouse is running before starting tests
            await ensureClickHouse();

            // Initialize common test infrastructure
            await commonBeforeEach();

            // Create shared request (server instance)
            sharedRequest = await createTestRequest();

            // Create shared ClickHouse manager
            const configManager = new ConfigManager();
            sharedClickHouseManager = new ClickHouseClientManager({ configManager });

            // Wait for ClickHouse to be ready
            await waitForClickHouse(sharedClickHouseManager);

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
 * Cleans up test data between tests (call in beforeEach)
 * Only truncates data, keeps connections alive
 *
 * @returns {Promise<void>}
 */
async function cleanupBetweenTests() {
    if (!sharedClickHouseManager) {
        return;
    }

    try {
        // Truncate all Group-related tables in dependency order
        // 1. Truncate materialized view target tables first (they depend on events table)
        await sharedClickHouseManager.truncateTableAsync('fhir_group_member_current_by_entity');
        await sharedClickHouseManager.truncateTableAsync('fhir_group_member_current');

        // 2. Truncate source events table
        await sharedClickHouseManager.truncateTableAsync('fhir_group_member_events');

        // 3. Clean MongoDB to prevent test pollution
        // Required for search tests where multiple tests create groups with same member references
        const { createTestContainer } = require('../createTestContainer');
        const container = createTestContainer();
        if (container && container.mongoClient) {
            const mongoClient = container.mongoClient;
            const db = mongoClient.db(container.configManager.mongoDbName);
            await db.collection('Group_4_0_0').deleteMany({});
        }
    } catch (e) {
        // Ignore errors if tables don't exist yet (first test run)
        if (!e.message.includes('does not exist')) {
            console.warn('Cleanup warning:', e.message);
        }
    }
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
        console.warn('Warning: Could not optimize tables:', e.message);
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

module.exports = {
    setupGroupTests,
    teardownGroupTests,
    cleanupBetweenTests,
    syncClickHouseMaterializedViews,
    getSharedRequest,
    getClickHouseManager,
    getTestHeaders,
    waitForData
};
