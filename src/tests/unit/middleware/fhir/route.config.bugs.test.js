'use strict';

/**
 * Category B — asserts the CORRECT behaviour of src/middleware/fhir/route.config.js and
 * FAILS against current `main` by design.
 *
 * An entry in the shared route table that references an INTERACTIONS constant that does not
 * exist is built with `interaction: undefined`.
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
});
