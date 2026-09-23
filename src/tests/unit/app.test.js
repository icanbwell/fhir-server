'use strict';

/**
 * Tests for src/app.js -- Express app assembly: middleware ORDER, security headers, and route
 * mounting.
 *
 * app.js's job is deciding the middleware chain order. A security middleware (helmet, auth,
 * CORS) registered AFTER a route that needs it leaves that route unprotected -- Express matches
 * middleware/routes in registration order per request, and a route that terminates the request
 * (sends a response) never reaches anything registered later in the stack. These tests assert on
 * the ACTUAL middleware stack (`app.router.stack`) and on real HTTP responses via supertest
 * through the REAL createApp()/createContainer() -- nothing about app.js's own logic is mocked.
 *
 * Domain invariants exercised here (see .qa/shards/G-invariants.md):
 *  - INV-G6: helmet() and the CSP/no-store-cache middlewares are registered before every route,
 *    so no route can accidentally skip them.
 *  - INV-G7: /admin/* is unreachable without a valid credential (auth middleware precedes the
 *    route handler inside adminRouter).
 *  - INV-G8: /mcp/* only exists when configManager.enableMcp is true; when false the route must
 *    not resolve to the MCP handler at all (real absence, not just "unauthenticated").
 *  - INV-G9: routes registered before the global `cors()` middleware (health/live/etc.) do not
 *    inherit it; routes registered after (e.g. /version) do -- this is a structural property of
 *    Express's middleware stack, not a header side-effect that could be masked by fetch defaults.
 *
 * READ FIRST: src/routeHandlers/fhirServer.js (MyFHIRServer -- createFhirApp's route mounting),
 * src/app.js itself.
 */

const { describe, test, expect, beforeAll, afterAll, jest: jestObj } = require('@jest/globals');
const request = require('supertest');

// See src/tests/unit/createContainer.test.js for why this stub is required: fhirOperationsManager
// (required transitively by createContainer.js, which app.js's tests need in order to build a
// real container) pulls in operations/summary/summary.js, which requires the ESM-only
// @icanbwell/fhirpatientsummary package that this repo's jest.unit.config.js does not allowlist
// for transformation.
jestObj.mock('@icanbwell/fhirpatientsummary', () => ({
    ComprehensiveIPSCompositionBuilder: class ComprehensiveIPSCompositionBuilder {},
    TBundle: class TBundle {}
}), { virtual: true });

// Config required by app.js's route handlers / config.js that jest/setEnvVars.js does not set.
process.env.PERSON_MATCHING_SERVICE_CLIENT_ID = process.env.PERSON_MATCHING_SERVICE_CLIENT_ID || 'test-client-id';
process.env.PERSON_MATCHING_SERVICE_CLIENT_SECRET = process.env.PERSON_MATCHING_SERVICE_CLIENT_SECRET || 'test-client-secret';
process.env.PERSON_MATCHING_SERVICE_TOKEN_URL = process.env.PERSON_MATCHING_SERVICE_TOKEN_URL || 'https://example.test/token';
process.env.AUTH_CODE_FLOW_URL = process.env.AUTH_CODE_FLOW_URL || 'https://auth.example.test';
process.env.AUTH_CODE_FLOW_CLIENT_ID = process.env.AUTH_CODE_FLOW_CLIENT_ID || 'test-auth-client';
// This whole file exercises route MOUNTING/ORDER, not audit-event persistence -- disable it so
// the (real, unmocked) auditLogger fire-and-forget calls triggered by 401/403 responses don't
// attempt Mongo writes or leave stray timers across tests.
process.env.ENABLE_ACCESS_AUDIT_EVENT = '0';

const { createContainer } = require('../../createContainer');
const { createApp } = require('../../app');

/**
 * Builds a real container + real app with the GraphQL/GraphQLv2/MCP feature flags forced to a
 * known state. Every other env var comes from jest/setEnvVars.js. Restores whatever it changed.
 * @param {{graphql?: boolean, graphqlV2?: boolean, mcp?: boolean, swagger?: boolean}} flags
 * @returns {{app: import('express').Express, restore: () => void}}
 */
function buildApp(flags = {}) {
    const keys = ['ENABLE_GRAPHQL', 'ENABLE_GRAPHQLV2', 'ENABLE_MCP', 'ENABLE_SWAGGER_DOC'];
    const original = {};
    for (const key of keys) {
        original[key] = process.env[key];
    }
    process.env.ENABLE_GRAPHQL = flags.graphql ? '1' : '0';
    process.env.ENABLE_GRAPHQLV2 = flags.graphqlV2 ? '1' : '0';
    process.env.ENABLE_MCP = flags.mcp ? '1' : '0';
    if (flags.swagger) {
        process.env.ENABLE_SWAGGER_DOC = '1';
    } else {
        delete process.env.ENABLE_SWAGGER_DOC;
    }

    const container = createContainer();
    const app = createApp({ fnGetContainer: () => container });

    const restore = () => {
        for (const key of keys) {
            if (original[key] === undefined) {
                delete process.env[key];
            } else {
                process.env[key] = original[key];
            }
        }
    };
    return { app, container, restore };
}

/** Finds the index of a named middleware/route layer in app.router.stack, or -1. */
function stackIndexOfName(app, name) {
    return app.router.stack.findIndex((layer) => layer.name === name);
}

/** Finds the index of a GET/ALL route registered at an exact path, or -1. */
function stackIndexOfRoute(app, path) {
    return app.router.stack.findIndex((layer) => layer.route && layer.route.path === path);
}

describe('createApp', () => {
    /** @type {import('express').Express} */
    let sharedApp;
    /** @type {() => void} */
    let restoreShared;

    beforeAll(() => {
        const built = buildApp({ graphql: false, graphqlV2: false, mcp: false });
        sharedApp = built.app;
        restoreShared = built.restore;
    });

    afterAll(() => {
        restoreShared();
    });

    test('helmet() is registered before every route, so every route response carries its security headers', async () => {
        const res = await request(sharedApp).get('/live');
        expect(res.status).toBe(200);
        expect(res.headers['x-content-type-options']).toBe('nosniff');
        expect(res.headers['x-frame-options']).toBe('SAMEORIGIN');
        expect(res.headers['x-dns-prefetch-control']).toBe('off');
    });

    test('the Content-Security-Policy middleware runs before every route and stamps a per-request nonce', async () => {
        const res = await request(sharedApp).get('/live');
        expect(res.headers['content-security-policy']).toBeDefined();
        expect(res.headers['content-security-policy']).toMatch(/'nonce-[^']+'/);
    });

    test('the disableBrowserCache middleware runs before every route', async () => {
        const res = await request(sharedApp).get('/live');
        expect(res.headers['cache-control']).toBe('no-store, no-cache');
        expect(res.headers.pragma).toBe('no-cache');
    });

    test('/robots.txt returns 404 (its own body text is unreachable -- see G-invariants.md observation on route ordering)', async () => {
        // app.js registers `app.get('/robots.txt', (req, res) => res.status(404).send('Not
        // Found'))` AFTER createFhirApp() has already installed a catch-all 404 handler with no
        // path restriction, so this route never actually executes; the response body is `{}`
        // (from the FHIR error/not-found chain), not the literal 'Not Found' text the source
        // implies. The 404 status itself is correct and is what this test asserts.
        const res = await request(sharedApp).get('/robots.txt');
        expect(res.status).toBe(404);
    });

    test('/live liveness probe returns 200 without any credential', async () => {
        const res = await request(sharedApp).get('/live');
        expect(res.status).toBe(200);
    });

    test('SECURITY (INV-G7): /admin/* rejects requests with no credential with a 401 OperationOutcome, never falling through to the handler', async () => {
        const res = await request(sharedApp).get('/admin/foo');
        expect(res.status).toBe(401);
        expect(res.body).toEqual({
            resourceType: 'OperationOutcome',
            issue: [{ severity: 'error', code: 'security', diagnostics: 'Authentication failed' }]
        });
    });

    test('SECURITY (INV-G7): /admin POST also rejects an unauthenticated request before reaching the content-type/json-body middleware', async () => {
        // If auth were registered AFTER the body-parsing middleware, an attacker could still
        // exercise the JSON parser (and any parsing-time side effects) without a credential.
        const res = await request(sharedApp)
            .post('/admin/export')
            .set('Content-Type', 'text/plain')
            .send('not json, not an allowed content-type either');
        expect(res.status).toBe(401);
    });

    test('INV-G8: /mcp/* does not exist (404) when configManager.enableMcp is false, the default', async () => {
        const res = await request(sharedApp).get('/mcp/anything');
        expect(res.status).toBe(404);
    });

    test('INV-G8: /mcp/* exists and is auth-gated (401, not 404) when configManager.enableMcp is true', async () => {
        const { app, restore } = buildApp({ mcp: true });
        try {
            const res = await request(app).get('/mcp/anything');
            // Mounted (unlike the disabled case above) but still requires a credential.
            expect(res.status).toBe(401);
        } finally {
            restore();
        }
    });

    test('propagates a caller-supplied x-request-id onto error responses (request-id plumbing wired end to end)', async () => {
        const requestId = 'test-request-id-12345';
        const res = await request(sharedApp)
            .get('/4_0_0/ThisResourceTypeDoesNotExist/unknown-id-path')
            .set('x-request-id', requestId);
        expect(res.headers['x-request-id']).toBe(requestId);
    });

    test('INV-G9: /health and /live are registered before the global cors() middleware in the stack', () => {
        const corsIndex = stackIndexOfName(sharedApp, 'corsMiddleware');
        const healthIndex = stackIndexOfRoute(sharedApp, '/health');
        const liveIndex = stackIndexOfRoute(sharedApp, '/live');
        expect(corsIndex).toBeGreaterThan(-1);
        expect(healthIndex).toBeGreaterThan(-1);
        expect(healthIndex).toBeLessThan(corsIndex);
        expect(liveIndex).toBeLessThan(corsIndex);
    });

    test('INV-G9: /version is registered after the global cors() middleware in the stack', () => {
        const corsIndex = stackIndexOfName(sharedApp, 'corsMiddleware');
        const versionIndex = stackIndexOfRoute(sharedApp, '/version');
        expect(versionIndex).toBeGreaterThan(-1);
        expect(versionIndex).toBeGreaterThan(corsIndex);
    });

    test('app.set(\'trust proxy\', ...) reflects configManager.trustProxyHopCount', () => {
        const original = process.env.TRUST_PROXY_HOP_COUNT;
        process.env.TRUST_PROXY_HOP_COUNT = '7';
        try {
            const { app, restore } = buildApp({});
            try {
                expect(app.get('trust proxy')).toEqual(7);
            } finally {
                restore();
            }
        } finally {
            if (original === undefined) {
                delete process.env.TRUST_PROXY_HOP_COUNT;
            } else {
                process.env.TRUST_PROXY_HOP_COUNT = original;
            }
        }
    });

    test('app.locals is populated with real deploy metadata, not left undefined', () => {
        expect(sharedApp.locals.currentYear).toBe(new Date().getFullYear());
        expect(sharedApp.locals.deployEnvironment).toBe(process.env.ENVIRONMENT);
        expect(sharedApp.locals.deployVersion).toBeDefined();
    });

    test('Swagger UI is not mounted by default (/api-docs 404s) but is served when ENABLE_SWAGGER_DOC is set', async () => {
        const disabled = await request(sharedApp).get('/api-docs/');
        expect(disabled.status).toBe(404);

        const { app, restore } = buildApp({ swagger: true });
        try {
            const enabled = await request(app).get('/api-docs/');
            expect(enabled.status).not.toBe(404);
        } finally {
            restore();
        }
    });

    test('/oauth/config exposes the server-computed token URL and client id (never trusts a client-supplied endpoint)', async () => {
        const res = await request(sharedApp).get('/oauth/config');
        expect(res.status).toBe(200);
        expect(res.body).toEqual({
            tokenUrl: `${process.env.AUTH_CODE_FLOW_URL}/oauth2/token`,
            clientId: process.env.AUTH_CODE_FLOW_CLIENT_ID
        });
    });

    test('/fhir -> /authcallback state round-trips the original resource URL exactly (base64/URI-encoding pairing)', async () => {
        const resourceUrl = '/4_0_0/Patient?name=Smith&_count=10';
        const redirect = await request(sharedApp).get('/fhir').query({ resource: resourceUrl });
        expect(redirect.status).toBe(302);
        const redirectUrl = new URL(redirect.headers.location);
        const code = 'auth-code-xyz';
        const callback = await request(sharedApp)
            .get('/authcallback')
            .query({ state: redirectUrl.searchParams.get('state'), code });
        expect(callback.status).toBe(302);
        const callbackLocation = new URL(callback.headers.location, 'http://localhost');
        expect(callbackLocation.searchParams.get('code')).toBe(code);
        expect(decodeURIComponent(callbackLocation.searchParams.get('resourceUrl'))).toBe(resourceUrl);
    });

    test('/logout and /logout_action routes are mounted (not 404)', async () => {
        const logout = await request(sharedApp).get('/logout');
        const logoutAction = await request(sharedApp).get('/logout_action');
        expect(logout.status).not.toBe(404);
        expect(logoutAction.status).not.toBe(404);
    });

    test('/$graphql is not mounted (404) when GraphQL is disabled, never reaching a GraphQL handler', async () => {
        // GET (not POST) so the FHIR content-type validator's GET/DELETE bypass keeps this test
        // isolated to route-mounting, rather than exercising unrelated content-type rejection.
        const res = await request(sharedApp).get('/$graphql');
        expect(res.status).toBe(404);
    });

    test('DEFENSIVE: incoming request count exceeding noOfRequestsPerPod is rejected with 429 before any route runs', async () => {
        const originalLimit = process.env.NO_OF_REQUESTS_PER_POD;
        process.env.NO_OF_REQUESTS_PER_POD = '-1';
        try {
            // Fresh requestCounter module (its request-count is module-level, process-wide state)
            // guarantees the count starts at 0 regardless of activity from earlier tests in this
            // file, so `0 > -1` trips on the very first request deterministically.
            let res;
            jestObj.isolateModules(() => {
                const isolatedContainer = require('../../createContainer').createContainer();
                const isolatedApp = require('../../app').createApp({ fnGetContainer: () => isolatedContainer });
                res = isolatedApp;
            });
            const response = await request(res).get('/live');
            expect(response.status).toBe(429);
            expect(response.text).toBe('Too Many Requests');
        } finally {
            if (originalLimit === undefined) {
                delete process.env.NO_OF_REQUESTS_PER_POD;
            } else {
                process.env.NO_OF_REQUESTS_PER_POD = originalLimit;
            }
        }
    });
});
