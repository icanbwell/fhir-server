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
const { USE_EXTERNAL_STORAGE_HEADER } = require('../../utils/contextDataBuilder');

// Set env vars
// These are read lazily by ConfigManager getters, not at import time.
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
            // ClickHouse container is started once by jestGlobalSetup; CLICKHOUSE_HOST/PORT
            // are inherited via process.env from the parent process.

            // Initialize common test infrastructure
            await commonBeforeEach();

            // Create shared request (server instance)
            sharedRequest = await createTestRequest();

            // Create shared ClickHouse manager pointed at the container started by jestGlobalSetup.
            const configManager = new ConfigManager();
            sharedClickHouseManager = new ClickHouseClientManager({ configManager });

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

        // ClickHouse container is stopped once by jestGlobalTeardown.

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
 * Truncates all Group test data from ClickHouse and MongoDB
 *
 * @returns {Promise<void>}
 */
async function cleanupAllData() {
    if (!sharedClickHouseManager) {
        return;
    }

    try {
        await sharedClickHouseManager.truncateTableAsync('Group_4_0_0_MemberCurrentByEntity');
        await sharedClickHouseManager.truncateTableAsync('Group_4_0_0_MemberCurrent');
        await sharedClickHouseManager.truncateTableAsync('Group_4_0_0_MemberEvents');

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
            query: 'OPTIMIZE TABLE fhir.Group_4_0_0_MemberCurrentByEntity FINAL'
        });

        await sharedClickHouseManager.queryAsync({
            query: 'OPTIMIZE TABLE fhir.Group_4_0_0_MemberCurrent FINAL'
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
 * Helper to get headers with the useExternalStorage flag enabled
 * Used by tests that exercise ClickHouse member storage paths
 */
function getTestHeadersWithExternalStorage() {
    return {
        ...getHeaders(),
        [USE_EXTERNAL_STORAGE_HEADER]: 'true'
    };
}

module.exports = {
    setupGroupTests,
    teardownGroupTests,
    cleanupAllData,
    syncClickHouseMaterializedViews,
    getSharedRequest,
    getClickHouseManager,
    getTestHeaders,
    getTestHeadersWithExternalStorage,
    waitForData
};
