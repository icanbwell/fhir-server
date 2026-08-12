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

const { commonBeforeEach, commonAfterEach, createTestRequest, getHeaders, getHeadersWithAdmin } = require('../common');
const { ConfigManager } = require('../../utils/configManager');
const { ClickHouseClientManager } = require('../../utils/clickHouseClientManager');
const { USE_EXTERNAL_STORAGE_HEADER } = require('../../utils/contextDataBuilder');
const { withNockSuspended } = require('../testContainerUtils');

// Set env vars
// These are read lazily by ConfigManager getters, not at import time.
process.env.ENABLE_CLICKHOUSE = '1';
process.env.MONGO_WITH_CLICKHOUSE_RESOURCES = 'Group';
process.env.CLICKHOUSE_WRITE_MODE = 'sync';
process.env.CLICKHOUSE_DATABASE = 'fhir';
process.env.LOGLEVEL = 'SILENT';
process.env.STREAM_RESPONSE = '0';

/**
 * supertest methods that start a new HTTP request.
 * @type {string[]}
 */
const HTTP_VERBS = ['get', 'post', 'put', 'patch', 'delete', 'del', 'head', 'options'];

/**
 * Runs a supertest request's actual HTTP round trip with nock suspended.
 *
 * Why: nock (v14, via @mswjs/interceptors) is active in every test because
 * ../common requires it, and importing it patches http.ClientRequest. Every
 * supertest request to the in-process server is therefore wrapped in a
 * MockHttpSocket "passthrough" that shares the real socket's underlying
 * _handle -- confirmed by inspecting `req.socket.constructor.name`, which is
 * MockHttpSocket while nock is active (even with nock.enableNetConnect()) and
 * only plain Socket after nock.restore(). Under the socket churn of the Group
 * suite that shared fd intermittently reads as invalid, and the real socket's
 * event forwarding re-emits it as an unhandled `read EINVAL` that aborts
 * whichever suite is running (see MockHttpSocket.ts passthrough handlers).
 *
 * Suspending nock for the duration of the round trip keeps these requests on
 * real, un-intercepted sockets. This mirrors what jest/patchClickHouseManager.js
 * already does for ClickHouse I/O; supertest traffic was never covered by it.
 *
 * Only `then` needs wrapping: superagent defers the request until the Test is
 * awaited, its chainable helpers (`set`/`send`/`query`) return the same object,
 * and `catch`/`finally` delegate to `then`.
 *
 * @param {import('supertest').Test} test
 * @returns {import('supertest').Test}
 */
function runWithNockSuspended(test) {
    const originalThen = test.then.bind(test);
    test.then = (onFulfilled, onRejected) =>
        withNockSuspended(() => originalThen()).then(onFulfilled, onRejected);
    return test;
}

/**
 * Wraps a supertest agent so every request it starts runs with nock suspended.
 *
 * @param {import('supertest').SuperTest} agent
 * @returns {import('supertest').SuperTest}
 */
function wrapAgentWithNockSuspended(agent) {
    return new Proxy(agent, {
        get(target, prop, receiver) {
            const value = Reflect.get(target, prop, receiver);
            if (typeof value !== 'function') {
                return value;
            }
            if (HTTP_VERBS.includes(prop)) {
                return (...args) => runWithNockSuspended(value.apply(target, args));
            }
            return value.bind(target);
        }
    });
}

// Shared singleton instances
let sharedRequest = null;
let sharedRequestWithNockSuspended = null;
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

            // Warm the JWKS cache while nock is still intercepting. Requests handed to
            // tests run with nock suspended (see wrapAgentWithNockSuspended), so a JWKS
            // cache miss would try to reach the mocked auth host over the real network
            // and fail auth. AuthService caches JWKS in a static LRU for 24h and every
            // lookup funnels through it (jwt.bearer.strategy passes getJwksByUrlAsync as
            // jwks-rsa's fetcher), so one warm-up covers the whole jest process.
            await sharedRequest.get('/4_0_0/Group?_count=1').set(getHeaders());

            sharedRequestWithNockSuspended = wrapAgentWithNockSuspended(sharedRequest);

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
        sharedRequestWithNockSuspended = null;
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
    if (!sharedRequestWithNockSuspended) {
        throw new Error('Shared request not initialized. Call setupGroupTests() in beforeAll first.');
    }
    return sharedRequestWithNockSuspended;
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
 * @param {{admin?: boolean}} [options] - pass { admin: true } for requests that also need
 *   admin scope
 */
function getTestHeadersWithExternalStorage ({ admin = false } = {}) {
    return {
        ...(admin ? getHeadersWithAdmin() : getHeaders()),
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
