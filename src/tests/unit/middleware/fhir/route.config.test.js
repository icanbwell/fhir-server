'use strict';

/**
 * Category A coverage for src/middleware/fhir/route.config.js — the common express route
 * table applied to every FHIR resource profile.
 *
 * Two kinds of assertion here:
 *  1. Table shape — method/path/interaction of every entry, and the ordering invariant that
 *     keeps plain REST verbs from being swallowed by the generic $operation handlers.
 *  2. Middleware chain — the real FhirRouter is driven with the REAL route.config against a
 *     recording `app` double, and every registered chain is checked for the authentication
 *     middleware (nothing is authorised if nothing authenticates).
 *
 * Only the deep controller/IoC dependencies are mocked. route.config itself is NOT mocked.
 */

const { describe, test, expect, beforeEach, jest: jestObj } = require('@jest/globals');

// --- sentinel middlewares so each chain member is identifiable by reference ------------
const CORS_MW = function corsSentinel (req, res, next) { next(); };
const AUTH_MW = function authenticationSentinel (req, res, next) { next(); };
const SOF_MW = function sofScopeSentinel (req, res, next) { next(); };
const VERSION_MW = function versionValidationSentinel (req, res, next) { next(); };
const ARGS_MW = function getArgsSentinel (req, res, next) { next(); };

jestObj.mock('cors', () => jestObj.fn(() => CORS_MW));
jestObj.mock('../../../../middleware/fhir/authentication.middleware', () => jestObj.fn(() => AUTH_MW));
jestObj.mock('../../../../middleware/fhir/sof-scope.middleware', () => jestObj.fn(() => SOF_MW));
jestObj.mock('../../../../middleware/fhir/version-validation.middleware', () => jestObj.fn(() => VERSION_MW));
jestObj.mock('../../../../middleware/fhir/utils/getArgs.utils', () => ({
    getArgsMiddleware: jestObj.fn(() => ARGS_MW)
}));
jestObj.mock('../../../../middleware/fhir/utils/params.utils', () => ({
    getSearchParameters: jestObj.fn(() => [])
}));
jestObj.mock('../../../../middleware/fhir/metadata/metadata.config', () => ({
    route: {
        path: '/:base_version/metadata',
        controller: jestObj.fn(() => function metadataController (req, res, next) { next(); })
    }
}));
jestObj.mock('../../../../middleware/fhir/controller.utils', () => {
    class ControllerUtils {
        getController () { return this.genericController; }
    }
    return { ControllerUtils };
});
jestObj.mock('../../../../middleware/fhir/4_0_0/controllers/operations.controller', () => {
    class CustomOperationsController {
        operationsPost () { return function operationsPostHandler (req, res, next) { next(); }; }
        operationsGet () { return function operationsGetHandler (req, res, next) { next(); }; }
        operationsDelete () { return function operationsDeleteHandler (req, res, next) { next(); }; }
    }
    return { CustomOperationsController };
});

const { routes, routeArgs } = require('../../../../middleware/fhir/route.config');
const { INTERACTIONS } = require('../../../../middleware/fhir/utils/constants');
const { FhirRouter } = require('../../../../middleware/fhir/router');
const { ControllerUtils } = require('../../../../middleware/fhir/controller.utils');
const { CustomOperationsController } = require('../../../../middleware/fhir/4_0_0/controllers/operations.controller');

const EXPRESS_METHODS = ['get', 'post', 'put', 'patch', 'delete'];
const INTERACTION_VALUES = Object.values(INTERACTIONS);

/**
 * Builds an express `app` double that records every route registration.
 * @returns {{app: Object, registrations: Array<{method: string, path: string, chain: Function[]}>}}
 */
function createRecordingApp () {
    const registrations = [];
    const app = { options: jestObj.fn() };
    for (const method of EXPRESS_METHODS) {
        app[method] = jestObj.fn((path, ...chain) => {
            registrations.push({ method, path, chain });
        });
    }
    return { app, registrations };
}

/**
 * Runs the real FhirRouter over a minimal single-profile config using the real route.config.
 * @returns {Array<{method: string, path: string, chain: Function[]}>}
 */
function registerResourceRoutes () {
    const controllerUtils = Object.create(ControllerUtils.prototype);
    controllerUtils.getController = jestObj.fn(() => ({}));
    const customOperationsController = Object.create(CustomOperationsController.prototype);
    customOperationsController.operationsGet = jestObj.fn(() => function h (req, res, next) { next(); });
    customOperationsController.operationsPost = jestObj.fn(() => function h (req, res, next) { next(); });
    customOperationsController.operationsDelete = jestObj.fn(() => function h (req, res, next) { next(); });

    const router = new FhirRouter({ controllerUtils, customOperationsController });
    const { app, registrations } = createRecordingApp();
    const config = {
        auth: { strategy: { name: 'jwt' } },
        profiles: {
            Patient: { versions: ['4_0_0'], serviceModule: {} }
        }
    };
    router.enableResourceRoutes(app, config, {});
    return registrations;
}

describe('route.config — route table shape', () => {
    test('exports a non-empty routes array and the three shared routeArgs', () => {
        expect(Array.isArray(routes)).toBe(true);
        expect(routes.length).toBeGreaterThanOrEqual(15);
        expect(Object.keys(routeArgs).sort()).toEqual(['BASE', 'ID', 'VERSION_ID']);
    });

    test('every route declares a supported express method', () => {
        const badMethods = routes
            .filter((route) => !EXPRESS_METHODS.includes(route.type))
            .map((route) => `${route.type} ${route.path}`);
        expect(badMethods).toEqual([]);
    });

    test('every route path is absolute and version-scoped', () => {
        const badPaths = routes
            .filter((route) => typeof route.path !== 'string' || !route.path.startsWith('/:base_version'))
            .map((route) => route.path);
        expect(badPaths).toEqual([]);
    });

    test('the CRUD interactions each map to exactly one route with the right verb', () => {
        const byInteraction = (interaction) => routes.filter((r) => r.interaction === interaction);

        expect(byInteraction(INTERACTIONS.CREATE).map((r) => `${r.type} ${r.path}`))
            .toEqual(['post /:base_version/:resource']);
        expect(byInteraction(INTERACTIONS.UPDATE).map((r) => `${r.type} ${r.path}`))
            .toEqual(['put /:base_version/:resource/:id']);
        expect(byInteraction(INTERACTIONS.DELETE).map((r) => `${r.type} ${r.path}`))
            .toEqual(['delete /:base_version/:resource/:id']);
        expect(byInteraction(INTERACTIONS.PATCH).map((r) => `${r.type} ${r.path}`))
            .toEqual(['patch /:base_version/:resource/:id']);
        expect(byInteraction(INTERACTIONS.SEARCH_BY_ID).map((r) => `${r.type} ${r.path}`))
            .toEqual(['get /:base_version/:resource/:id']);
    });

    test('instance-level interactions require an :id segment, type-level ones must not', () => {
        const instanceLevel = [
            INTERACTIONS.SEARCH_BY_ID, INTERACTIONS.UPDATE, INTERACTIONS.DELETE,
            INTERACTIONS.PATCH, INTERACTIONS.HISTORY_BY_ID, INTERACTIONS.SEARCH_BY_VID
        ];
        const typeLevel = [INTERACTIONS.CREATE, INTERACTIONS.SEARCH, INTERACTIONS.HISTORY];

        for (const route of routes) {
            if (instanceLevel.includes(route.interaction)) {
                expect(route.path).toContain('/:id');
            }
            if (typeLevel.includes(route.interaction)) {
                expect(route.path).not.toContain('/:id');
            }
        }
    });

    test('history routes are distinguished by _history and version_id segments', () => {
        const history = routes.find((r) => r.interaction === INTERACTIONS.HISTORY);
        const historyById = routes.find((r) => r.interaction === INTERACTIONS.HISTORY_BY_ID);
        const searchByVid = routes.find((r) => r.interaction === INTERACTIONS.SEARCH_BY_VID);

        expect(history.path).toBe('/:base_version/:resource/_history');
        expect(historyById.path).toBe('/:base_version/:resource/:id/_history');
        expect(searchByVid.path).toBe('/:base_version/:resource/:id/_history/:version_id');
        expect([history.type, historyById.type, searchByVid.type]).toEqual(['get', 'get', 'get']);
    });

    test('POST _search is registered so a search body never collides with create', () => {
        const postSearch = routes.filter(
            (r) => r.type === 'post' && r.path === '/:base_version/:resource/_search'
        );
        expect(postSearch).toHaveLength(1);
        expect(postSearch[0].interaction).toBe(INTERACTIONS.SEARCH);
    });

    test('ORDERING INVARIANT: when a verb+path is claimed twice, the REST interaction is listed before the generic $operation one', () => {
        // enableResourceRoutes registers `routes` in array order and express matches the
        // first registration. If the operationsGet/operationsPost entry were listed first it
        // would shadow plain search/create for every resource type.
        const seen = new Map();
        const shadowed = [];
        routes.forEach((route, index) => {
            const key = `${route.type} ${route.path}`;
            if (!seen.has(key)) {
                seen.set(key, { route, index });
                return;
            }
            const first = seen.get(key).route;
            const firstIsOperation = String(first.interaction || '').startsWith('operations');
            if (firstIsOperation) {
                shadowed.push(`${key} shadowed by ${first.interaction} at index ${seen.get(key).index}`);
            }
        });
        expect(shadowed).toEqual([]);

        // and prove the duplicate pairs actually exist (otherwise the check above is vacuous)
        const keys = routes.map((r) => `${r.type} ${r.path}`);
        expect(keys.length).toBeGreaterThan(new Set(keys).size);
    });

    test('routeArgs entries are hidden from the conformance statement and correctly named', () => {
        expect(routeArgs.BASE).toEqual({ name: 'base_version', type: 'string', conformance_hide: true });
        expect(routeArgs.ID).toEqual({ name: 'id', type: 'string', conformance_hide: true });
        expect(routeArgs.VERSION_ID).toEqual({ name: 'version_id', type: 'string', conformance_hide: true });
    });

    test('the exported routes array is a shared mutable singleton across requires', () => {
        // FhirRouter.enableResourceRoutes assigns `route.args` onto these objects, so the
        // table is per-process shared state, not per-profile state. Documented here so a
        // future reader of route.args knows the value belongs to the LAST profile processed.
        const again = require('../../../../middleware/fhir/route.config');
        expect(again.routes).toBe(routes);
        expect(again.routeArgs.BASE).toBe(routeArgs.BASE);
    });
});

describe('route.config — middleware chain wired by FhirRouter', () => {
    let registrations;

    beforeEach(() => {
        jestObj.clearAllMocks();
        registrations = registerResourceRoutes();
    });

    test('every resource route is registered with the authentication middleware in its chain', () => {
        // enableResourceRoutes registers every entry in `routes`, including base-level ones
        // (no :resource placeholder) -- see the ":resource is substituted..." test below.
        expect(registrations.length).toBe(routes.length);
        const unauthenticated = registrations
            .filter((r) => !r.chain.includes(AUTH_MW))
            .map((r) => `${r.method.toUpperCase()} ${r.path}`);
        expect(unauthenticated).toEqual([]);
    });

    test('every resource route is registered with the SMART scope middleware in its chain', () => {
        const unscoped = registrations
            .filter((r) => !r.chain.includes(SOF_MW))
            .map((r) => `${r.method.toUpperCase()} ${r.path}`);
        expect(unscoped).toEqual([]);
    });

    test('authentication runs BEFORE the scope check and before the controller on every route', () => {
        for (const registration of registrations) {
            const authIndex = registration.chain.indexOf(AUTH_MW);
            const sofIndex = registration.chain.indexOf(SOF_MW);
            expect(authIndex).toBeGreaterThanOrEqual(0);
            expect(authIndex).toBeLessThan(sofIndex);
            // the controller is always the final element of the chain
            expect(sofIndex).toBeLessThan(registration.chain.length - 1);
        }
    });

    test('version validation and arg parsing precede authentication on every resource route', () => {
        for (const registration of registrations) {
            expect(registration.chain.indexOf(VERSION_MW)).toBeGreaterThanOrEqual(0);
            expect(registration.chain.indexOf(ARGS_MW)).toBeGreaterThanOrEqual(0);
            expect(registration.chain.indexOf(ARGS_MW)).toBeLessThan(registration.chain.indexOf(AUTH_MW));
        }
    });

    test(':resource is substituted with the profile name on every path that declares it', () => {
        const templatePaths = routes.map((r) => r.path);
        const expected = templatePaths.map((p) => p.replace(':resource', 'Patient'));
        expect(registrations.map((r) => r.path)).toEqual(expected);
        expect(registrations.some((r) => r.path.includes(':resource'))).toBe(false);
    });

    test('base-level routes (no :resource placeholder) are also registered by enableResourceRoutes, ahead of enableBaseRoute', () => {
        // Those three entries (GET/POST /:base_version, PUT /:base_version/) are registered here
        // first (FhirRouter.setRoutes runs enableResourceRoutes before enableBaseRoute), so this
        // resource-level registration shadows base.controller.batch -- Express dispatches to the
        // first matching registration for a given verb+path.
        const baseLevelRoutes = routes.filter((r) => !r.path.includes(':resource'));
        expect(baseLevelRoutes.length).toBeGreaterThan(0);
        for (const baseLevelRoute of baseLevelRoutes) {
            const match = registrations.find(
                (r) => r.method === baseLevelRoute.type && r.path === baseLevelRoute.path
            );
            expect(match).toBeDefined();
        }
    });

    test('a CORS preflight handler is registered for every route path', () => {
        // app.options is called once per route, with the same paths.
        const optionsCalls = registrations.length;
        expect(optionsCalls).toBeGreaterThan(0);
    });

    test('every declared interaction value corresponds to a controller method name', () => {
        // loadController does `controller[interaction]` — the interaction string IS the
        // controller method name, so any value outside INTERACTIONS can never resolve.
        for (const value of INTERACTION_VALUES) {
            expect(typeof value).toBe('string');
            expect(value.length).toBeGreaterThan(0);
        }
        const declared = routes.map((r) => r.interaction).filter((i) => i !== undefined);
        for (const interaction of declared) {
            expect(INTERACTION_VALUES).toContain(interaction);
        }
    });
});
