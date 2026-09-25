'use strict';

/**
 * Category B — asserts the CORRECT behaviour of src/middleware/fhir/export/export.config.js
 * and FAILS against current `main` by design.
 *
 * export.config entries describe themselves with `method` + `operation` but carry
 * no `interaction`. FhirRouter.enableExportRoutes therefore cannot hand sof-scope an
 * interaction and instead passes the raw path string (`sofScopeMiddleware({ route: profile.path, ... })`,
 * router.js:~600). sof-scope then reads `route.interaction` off a string, gets `undefined`,
 * and — because sof-scope.middleware.js:24 spells one of its read-group cases as
 * `case INTERACTIONS.EXPAND_BY_ID:` (a constant that does not exist, i.e. `case undefined:`) —
 * grades EVERY bulk-export route, including the POST job kick-off, as a READ.
 *
 * Entry point: `POST /4_0_0/$export` with ENABLE_BULK_EXPORT enabled and SMART scopes in use.
 * Required inputs: a bearer token whose only scope is read (e.g. `user/*.read`).
 * Nothing upstream re-grades the request — authentication only proves identity.
 */

const { describe, test, expect, beforeEach, afterEach, jest: jestObj } = require('@jest/globals');

const { routes: exportRoutes } = require('../../../../../middleware/fhir/export/export.config');
const { INTERACTIONS } = require('../../../../../middleware/fhir/utils/constants');
const sofScopeMiddleware = require('../../../../../middleware/fhir/sof-scope.middleware');

/** Maps an HTTP verb to the interaction the router would need in order to grade it. */
const EXPECTED_INTERACTION = {
    GET: INTERACTIONS.OPERATIONS_GET,
    POST: INTERACTIONS.OPERATIONS_POST,
    DELETE: INTERACTIONS.OPERATIONS_DELETE
};

describe('export.config — scope grading metadata (Category B, fail by design)', () => {
    test('every export route must declare an interaction matching its HTTP verb', () => {
        const missing = exportRoutes
            .filter((route) => route.interaction !== EXPECTED_INTERACTION[route.method])
            .map((route) => `${route.method} ${route.path} -> ${String(route.interaction)}`);

        expect(missing).toEqual([]);
    });

    test('the POST kick-off routes must be gradeable as writes', () => {
        const postRoutes = exportRoutes.filter((r) => r.method === 'POST');
        expect(postRoutes.length).toBeGreaterThan(0);

        for (const route of postRoutes) {
            expect(route.interaction).toBe(INTERACTIONS.OPERATIONS_POST);
        }
    });
});

describe('export.config — SMART scope enforcement on $export (Category B, fail by design)', () => {
    const originalNodeEnv = process.env.NODE_ENV;
    const smartAuth = { type: 'smart', strategy: { name: 'jwt' } };

    beforeEach(() => {
        // sof-scope short-circuits to a no-op under NODE_ENV=test; exercise the real path.
        process.env.NODE_ENV = 'production';
    });

    afterEach(() => {
        process.env.NODE_ENV = originalNodeEnv;
    });

    test('POST /:base_version/$export must reject a read-only SMART scope', () => {
        const postExport = exportRoutes.find((r) => r.method === 'POST' && r.path === '/:base_version/$export');
        expect(postExport).toBeDefined();

        // Build the middleware exactly the way FhirRouter.enableExportRoutes does today.
        const middleware = sofScopeMiddleware({
            route: postExport.path,
            name: postExport.operation,
            auth: smartAuth
        });

        const req = { user: { scope: 'user/*.read' }, params: { version: '4_0_0' } };
        const next = jestObj.fn();
        middleware(req, {}, next);

        // Control: a caller with NO scopes at all is already rejected, proving the harness
        // reaches the real scope checker rather than a no-op.
        const noScopeNext = jestObj.fn();
        sofScopeMiddleware({ route: postExport.path, name: postExport.operation, auth: smartAuth })(
            { user: { scope: '' }, params: { version: '4_0_0' } }, {}, noScopeNext
        );
        expect(noScopeNext.mock.calls[0][0]).toBeDefined();

        // Kicking off a bulk export of whole-population PHI is a write-class operation and
        // must not be satisfied by a read-only scope.
        expect(next).toHaveBeenCalledTimes(1);
        expect(next.mock.calls[0][0]).toBeDefined();
    });

    test('POST /:base_version/Patient/$export must reject a read-only SMART scope', () => {
        const patientExport = exportRoutes.find(
            (r) => r.method === 'POST' && r.path === '/:base_version/Patient/$export'
        );
        expect(patientExport).toBeDefined();

        const next = jestObj.fn();
        sofScopeMiddleware({
            route: patientExport.path,
            name: patientExport.operation,
            auth: smartAuth
        })({ user: { scope: 'user/*.read' }, params: { version: '4_0_0' } }, {}, next);

        expect(next).toHaveBeenCalledTimes(1);
        expect(next.mock.calls[0][0]).toBeDefined();
    });
});
