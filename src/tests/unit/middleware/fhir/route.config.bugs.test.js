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
 * Consequence, reachable through FhirRouter.enableResourceRoutes (which registers every
 * entry of this table for every configured profile): loadController does
 * `controller[undefined]` -> the route always answers 404.
 */

const { describe, test, expect } = require('@jest/globals');

const { routes } = require('../../../../middleware/fhir/route.config');
const { INTERACTIONS } = require('../../../../middleware/fhir/utils/constants');

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
