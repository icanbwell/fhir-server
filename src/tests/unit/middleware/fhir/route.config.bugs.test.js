'use strict';

/**
 * Category B — asserts the CORRECT behaviour of src/middleware/fhir/route.config.js and
 * FAILS against current `main` by design.
 *
 * Two entries in the shared route table reference INTERACTIONS constants that do
 * not exist (`INTERACTIONS.EXPAND_BY_ID` at route.config.js:55 and `INTERACTIONS.OPERATIONS_PUT`
 * at route.config.js:81). Neither key is defined in src/middleware/fhir/utils/constants.js, so
 * both entries are built with `interaction: undefined`.
 *
 * Consequences, both reachable through FhirRouter.enableResourceRoutes (which registers every
 * entry of this table for every configured profile):
 *   a) loadController does `controller[undefined]` -> the route always answers 404.
 *   b) sof-scope.middleware.js:24 spells one of its read-group cases as
 *      `case INTERACTIONS.EXPAND_BY_ID:` — i.e. literally `case undefined:`. So an
 *      unclassifiable route is graded as a READ instead of falling through to the
 *      restrictive `'*'` default. `PUT /:base_version/` is an HTTP write graded as a read.
 */

const { describe, test, expect, beforeEach, afterEach, jest: jestObj } = require('@jest/globals');

const { routes } = require('../../../../middleware/fhir/route.config');
const { INTERACTIONS } = require('../../../../middleware/fhir/utils/constants');
const sofScopeMiddleware = require('../../../../middleware/fhir/sof-scope.middleware');

describe('route.config — undefined interaction constants (Category B, fail by design)', () => {
    test('every route entry must declare an interaction that exists in INTERACTIONS', () => {
        const validInteractions = Object.values(INTERACTIONS);
        const invalid = routes
            .filter((route) => !validInteractions.includes(route.interaction))
            .map((route) => `${route.type.toUpperCase()} ${route.path} -> ${String(route.interaction)}`);

        expect(invalid).toEqual([]);
    });

    test('the $expand route must resolve to a real controller interaction', () => {
        const expandRoute = routes.find((r) => r.path === '/:base_version/:resource/:id/$expand');
        expect(expandRoute).toBeDefined();
        expect(expandRoute.type).toBe('get');

        // loadController does `controller[route.interaction]`; undefined can never resolve,
        // so this route is permanently a 404 for every configured profile.
        expect(expandRoute.interaction).toBeDefined();
        expect(Object.values(INTERACTIONS)).toContain(expandRoute.interaction);
    });

    test('the base-level PUT route must resolve to a real controller interaction', () => {
        const putRoute = routes.find((r) => r.type === 'put' && r.path === '/:base_version/');
        expect(putRoute).toBeDefined();

        expect(putRoute.interaction).toBeDefined();
        expect(Object.values(INTERACTIONS)).toContain(putRoute.interaction);
    });
});

describe('route.config — SMART scope grading of the undefined-interaction routes', () => {
    const originalNodeEnv = process.env.NODE_ENV;

    beforeEach(() => {
        // sof-scope.middleware short-circuits to a no-op when NODE_ENV === 'test'; the whole
        // point of this test is the production grading path.
        process.env.NODE_ENV = 'production';
    });

    afterEach(() => {
        process.env.NODE_ENV = originalNodeEnv;
    });

    test('PUT /:base_version/ is an HTTP write and must NOT be satisfied by a read-only SMART scope', () => {
        const putRoute = routes.find((r) => r.type === 'put' && r.path === '/:base_version/');
        const middleware = sofScopeMiddleware({
            route: putRoute,
            name: 'Patient',
            auth: { type: 'smart', strategy: { name: 'jwt' } }
        });

        const req = { user: { scope: 'user/Patient.read' }, params: { version: '4_0_0' } };
        const next = jestObj.fn();
        middleware(req, {}, next);

        // Control: the same read-only scope legitimately passes a real read route, proving
        // the harness itself is wired correctly and the assertion below is about grading.
        const searchRoute = routes.find((r) => r.interaction === INTERACTIONS.SEARCH);
        const readNext = jestObj.fn();
        sofScopeMiddleware({
            route: searchRoute,
            name: 'Patient',
            auth: { type: 'smart', strategy: { name: 'jwt' } }
        })(req, {}, readNext);
        expect(readNext).toHaveBeenCalledWith();

        // The write route must be rejected — `interaction: undefined` currently makes
        // deriveActionFromInteraction hit `case INTERACTIONS.EXPAND_BY_ID:` (=== undefined)
        // and grade it 'read', so next() is called with no error instead.
        expect(next).toHaveBeenCalledTimes(1);
        expect(next.mock.calls[0][0]).toBeDefined();
    });
});
