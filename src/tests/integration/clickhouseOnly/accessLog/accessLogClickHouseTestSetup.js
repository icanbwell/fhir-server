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
const { ClickHouseClientManager } = require('../../../../utils/clickHouseClientManager');
const { ConfigManager } = require('../../../../utils/configManager');
const { withNockSuspended } = require('../../testContainerUtils');

/**
 * supertest methods that start a new HTTP request.
 * @type {string[]}
 */
const HTTP_VERBS = ['get', 'post', 'put', 'patch', 'delete', 'del', 'head', 'options'];

/**
 * Runs a supertest request's actual HTTP round trip with nock suspended.
 *
 * Why: nock (v14, via @mswjs/interceptors) is active in every test because
 * ../../common requires it, and importing it patches http.ClientRequest. Every
 * supertest request to the in-process server is therefore wrapped in a
 * MockHttpSocket "passthrough" that shares the real socket's underlying
 * _handle. This test file also drives real ClickHouse HTTP traffic
 * (insertRows/cleanupBetweenTests) in the same process, and under that socket
 * churn the shared fd intermittently reads as invalid, surfacing as an
 * unhandled `read EINVAL` that aborts the suite (see
 * MockHttpSocket.ts passthrough handlers, and src/tests/group/groupTestSetup.js
 * which hit the same issue for the Group suite).
 *
 * Suspending nock for the duration of the round trip keeps these requests on
 * real, un-intercepted sockets.
 *
 * @param {import('supertest').Test} test
 * @returns {import('supertest').Test}
 */
function runWithNockSuspended (test) {
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
function wrapAgentWithNockSuspended (agent) {
    return new Proxy(agent, {
        get (target, prop, receiver) {
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

            const request = await createTestRequest();

            // Warm the JWKS cache while nock is still intercepting. Requests handed
            // to tests run with nock suspended (see wrapAgentWithNockSuspended), so a
            // JWKS cache miss would try to reach the mocked auth host over the real
            // network and fail auth. AuthService caches JWKS in a static LRU for 24h
            // and every lookup funnels through it, so one warm-up covers every
            // request (admin or non-admin) made in this file for the whole jest
            // process.
            await request.get('/admin/searchLogResults').set(getJsonHeadersWithAdminToken());

            sharedRequest = wrapAgentWithNockSuspended(request);

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
