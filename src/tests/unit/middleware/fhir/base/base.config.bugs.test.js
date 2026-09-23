'use strict';

/**
 * Category B — asserts the CORRECT behaviour of src/middleware/fhir/base/base.config.js and
 * FAILS against current `main` by design.
 *
 * The base-level batch/transaction endpoints declared in base.config.js are
 * unreachable. FhirRouter.setRoutes calls enableResourceRoutes BEFORE enableBaseRoute, and
 * route.config.js contains three entries whose path has no `:resource` placeholder
 * (`GET /:base_version`, `POST /:base_version`, `PUT /:base_version/`). Those are therefore
 * registered verbatim once per configured profile, ahead of base.config's own registration
 * of the same verb+path. Express matches the first registration, and the resource-level
 * handler answers with `next(new NotFoundError(...))` / the generic $operation controller
 * rather than falling through, so `POST|PUT|GET /:base_version` never reaches
 * base.controller.batch.
 *
 * Entry point: any HTTP client calling `POST /4_0_0/` with a `Bundle` of `type: batch`.
 * Required inputs: none beyond a configured profile (there is always at least one).
 * Nothing upstream prevents this — the shadowing happens at wiring time, unconditionally.
 */

const { describe, test, expect, beforeEach, jest: jestObj } = require('@jest/globals');

const CORS_MW = function corsSentinel (req, res, next) { next(); };
const AUTH_MW = function authenticationSentinel (req, res, next) { next(); };
const SOF_MW = function sofScopeSentinel (req, res, next) { next(); };
const VERSION_MW = function versionValidationSentinel (req, res, next) { next(); };
const ARGS_MW = function getArgsSentinel (req, res, next) { next(); };

jestObj.mock('cors', () => jestObj.fn(() => CORS_MW));
jestObj.mock('../../../../../middleware/fhir/authentication.middleware', () => jestObj.fn(() => AUTH_MW));
jestObj.mock('../../../../../middleware/fhir/sof-scope.middleware', () => jestObj.fn(() => SOF_MW));
jestObj.mock('../../../../../middleware/fhir/version-validation.middleware', () => jestObj.fn(() => VERSION_MW));
jestObj.mock('../../../../../middleware/fhir/utils/getArgs.utils', () => ({
    getArgsMiddleware: jestObj.fn(() => ARGS_MW)
}));
jestObj.mock('../../../../../middleware/fhir/utils/params.utils', () => ({
    getSearchParameters: jestObj.fn(() => [])
}));
jestObj.mock('../../../../../middleware/fhir/metadata/metadata.config', () => ({
    route: { path: '/:base_version/metadata', controller: jestObj.fn(() => function c (req, res, next) { next(); }) }
}));
jestObj.mock('../../../../../middleware/fhir/controller.utils', () => {
    class ControllerUtils { getController () { return {}; } }
    return { ControllerUtils };
});
jestObj.mock('../../../../../middleware/fhir/4_0_0/controllers/operations.controller', () => {
    class CustomOperationsController {
        operationsPost () { return function h (req, res, next) { next(); }; }
        operationsGet () { return function h (req, res, next) { next(); }; }
        operationsDelete () { return function h (req, res, next) { next(); }; }
    }
    return { CustomOperationsController };
});

const { routes: baseRoutes } = require('../../../../../middleware/fhir/base/base.config');
const { FhirRouter } = require('../../../../../middleware/fhir/router');
const { ControllerUtils } = require('../../../../../middleware/fhir/controller.utils');
const { CustomOperationsController } = require('../../../../../middleware/fhir/4_0_0/controllers/operations.controller');

const EXPRESS_METHODS = ['get', 'post', 'put', 'patch', 'delete'];

/** Express default (non-strict) routing treats `/x` and `/x/` as the same URL. */
const normalize = (p) => (p.length > 1 && p.endsWith('/') ? p.slice(0, -1) : p);

function registerInSetRoutesOrder () {
    const registrations = [];
    const app = { options: jestObj.fn() };
    for (const method of EXPRESS_METHODS) {
        app[method] = jestObj.fn((path, ...chain) => registrations.push({ method, path, chain }));
    }

    const controllerUtils = Object.create(ControllerUtils.prototype);
    controllerUtils.getController = jestObj.fn(() => ({}));
    const customOperationsController = Object.create(CustomOperationsController.prototype);
    customOperationsController.operationsGet = jestObj.fn(() => function h (req, res, next) { next(); });
    customOperationsController.operationsPost = jestObj.fn(() => function h (req, res, next) { next(); });
    customOperationsController.operationsDelete = jestObj.fn(() => function h (req, res, next) { next(); });

    const router = new FhirRouter({ controllerUtils, customOperationsController });
    const config = {
        auth: { strategy: { name: 'jwt' } },
        profiles: { Patient: { versions: ['4_0_0'], serviceModule: {} } }
    };

    // Same order as FhirRouter.setRoutes: resource routes first, base routes last.
    router.enableResourceRoutes(app, config, {});
    const baseStartIndex = registrations.length;
    router.enableBaseRoute(app, config, {});
    return { registrations, baseStartIndex };
}

describe('base.config — batch/transaction reachability (Category B, fail by design)', () => {
    let registrations;
    let baseStartIndex;

    beforeEach(() => {
        jestObj.clearAllMocks();
        ({ registrations, baseStartIndex } = registerInSetRoutesOrder());
    });

    test('no base.config route may be shadowed by an earlier resource-level registration', () => {
        const baseRegistrations = registrations.slice(baseStartIndex);
        expect(baseRegistrations).toHaveLength(baseRoutes.length);

        const shadowed = [];
        for (const baseRegistration of baseRegistrations) {
            const earlier = registrations
                .slice(0, baseStartIndex)
                .find((r) => r.method === baseRegistration.method &&
                    normalize(r.path) === normalize(baseRegistration.path));
            if (earlier) {
                shadowed.push(`${baseRegistration.method.toUpperCase()} ${baseRegistration.path}`);
            }
        }

        expect(shadowed).toEqual([]);
    });

    test('POST /:base_version/ must reach base.controller.batch, not a resource-level handler', () => {
        const postBatch = registrations.find(
            (r, i) => i >= baseStartIndex && r.method === 'post' && normalize(r.path) === '/:base_version'
        );
        expect(postBatch).toBeDefined();

        const firstPostMatch = registrations.find(
            (r) => r.method === 'post' && normalize(r.path) === '/:base_version'
        );
        // Express dispatches to the FIRST matching registration.
        expect(firstPostMatch).toBe(postBatch);
    });

    test('PUT /:base_version/ must reach base.controller.batch, not the 404-only resource route', () => {
        const putBatch = registrations.find(
            (r, i) => i >= baseStartIndex && r.method === 'put' && normalize(r.path) === '/:base_version'
        );
        expect(putBatch).toBeDefined();

        const firstPutMatch = registrations.find(
            (r) => r.method === 'put' && normalize(r.path) === '/:base_version'
        );
        expect(firstPutMatch).toBe(putBatch);
    });
});
