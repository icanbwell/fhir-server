'use strict';

/**
 * Category A coverage for src/middleware/fhir/base/base.config.js — the route table for the
 * base-level (non resource-scoped) endpoints: batch/transaction and $question.
 *
 * The table itself is asserted directly, and the chain FhirRouter.enableBaseRoute builds from
 * it is asserted against a recording `app` double using the REAL base.config.
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
const { routeArgs } = require('../../../../../middleware/fhir/route.config');
const baseController = require('../../../../../middleware/fhir/base/base.controller');
const { FhirRouter } = require('../../../../../middleware/fhir/router');
const { ControllerUtils } = require('../../../../../middleware/fhir/controller.utils');
const { CustomOperationsController } = require('../../../../../middleware/fhir/4_0_0/controllers/operations.controller');

const EXPRESS_METHODS = ['get', 'post', 'put', 'patch', 'delete'];

function createRecordingApp () {
    const registrations = [];
    const app = { options: jestObj.fn() };
    for (const method of EXPRESS_METHODS) {
        app[method] = jestObj.fn((path, ...chain) => registrations.push({ method, path, chain }));
    }
    return { app, registrations };
}

function registerBaseRoutes () {
    const controllerUtils = Object.create(ControllerUtils.prototype);
    controllerUtils.getController = jestObj.fn(() => ({}));
    const customOperationsController = Object.create(CustomOperationsController.prototype);
    const router = new FhirRouter({ controllerUtils, customOperationsController });
    const { app, registrations } = createRecordingApp();
    router.enableBaseRoute(app, {
        auth: { strategy: { name: 'jwt' } },
        profiles: { Patient: { versions: ['4_0_0'] } }
    }, {});
    return registrations;
}

describe('base.config — route table shape', () => {
    test('exports exactly the batch and $question endpoints', () => {
        expect(baseRoutes).toHaveLength(5);
        expect(baseRoutes.map((r) => `${r.type.toUpperCase()} ${r.path}`)).toEqual([
            'PUT /:base_version/',
            'POST /:base_version/',
            'GET /:base_version',
            'GET /:base_version/$question',
            'POST /:base_version/$question'
        ]);
    });

    test('every entry declares a supported express method and a version-scoped path', () => {
        for (const route of baseRoutes) {
            expect(EXPRESS_METHODS).toContain(route.type);
            expect(route.path.startsWith('/:base_version')).toBe(true);
        }
    });

    test('corsOptions.methods always matches the route verb (a mismatch would blank the preflight)', () => {
        const mismatches = baseRoutes
            .filter((r) => !r.corsOptions || r.corsOptions.methods.join(',') !== r.type.toUpperCase())
            .map((r) => `${r.type} ${r.path}`);
        expect(mismatches).toEqual([]);
    });

    test('controllers are bound to the real base.controller factories, not re-implementations', () => {
        const batchRoutes = baseRoutes.filter((r) => !r.path.includes('$question'));
        const questionRoutes = baseRoutes.filter((r) => r.path.includes('$question'));

        expect(batchRoutes).toHaveLength(3);
        expect(questionRoutes).toHaveLength(2);
        for (const route of batchRoutes) {
            expect(route.controller).toBe(baseController.batch);
        }
        for (const route of questionRoutes) {
            expect(route.controller).toBe(baseController.question);
        }
    });

    test('each controller factory produces a 3-arity express handler', () => {
        for (const route of baseRoutes) {
            const handler = route.controller({ config: {} });
            expect(typeof handler).toBe('function');
            expect(handler.length).toBe(3);
        }
    });

    test('each entry starts with an empty args list that the router later fills in', () => {
        for (const route of baseRoutes) {
            expect(Array.isArray(route.args)).toBe(true);
        }
    });
});

describe('base.config — middleware chain wired by FhirRouter.enableBaseRoute', () => {
    let registrations;

    beforeEach(() => {
        jestObj.clearAllMocks();
        registrations = registerBaseRoutes();
    });

    test('registers one express route per base.config entry, preserving verb and path', () => {
        expect(registrations).toHaveLength(baseRoutes.length);
        expect(registrations.map((r) => `${r.method.toUpperCase()} ${r.path}`)).toEqual(
            baseRoutes.map((r) => `${r.type.toUpperCase()} ${r.path}`)
        );
    });

    test('every base route is registered with the authentication middleware in its chain', () => {
        const unauthenticated = registrations
            .filter((r) => !r.chain.includes(AUTH_MW))
            .map((r) => `${r.method.toUpperCase()} ${r.path}`);
        expect(unauthenticated).toEqual([]);
    });

    test('authentication precedes the controller on every base route', () => {
        for (const registration of registrations) {
            const authIndex = registration.chain.indexOf(AUTH_MW);
            expect(authIndex).toBeGreaterThanOrEqual(0);
            expect(authIndex).toBe(registration.chain.length - 2);
            expect(typeof registration.chain[registration.chain.length - 1]).toBe('function');
        }
    });

    test('chain order is cors -> version validation -> args -> auth -> controller', () => {
        for (const registration of registrations) {
            expect(registration.chain.slice(0, 4)).toEqual([CORS_MW, VERSION_MW, ARGS_MW, AUTH_MW]);
            expect(registration.chain).toHaveLength(5);
        }
    });

    test('the router overwrites args with the shared base_version routeArg on every entry', () => {
        for (const route of baseRoutes) {
            expect(route.args).toEqual([routeArgs.BASE]);
            expect(route.args[0]).toBe(routeArgs.BASE);
        }
    });

    test('a CORS preflight is registered for every base route path', () => {
        // enableBaseRoute calls app.options once per entry before registering the verb.
        expect(registrations).toHaveLength(baseRoutes.length);
        expect(registrations.every((r) => r.chain[0] === CORS_MW)).toBe(true);
    });
});
