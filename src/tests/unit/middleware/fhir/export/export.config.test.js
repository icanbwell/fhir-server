'use strict';

/**
 * Category A coverage for src/middleware/fhir/export/export.config.js — the route table for
 * the bulk-data $export endpoints.
 *
 * The table is asserted directly, and the chain FhirRouter.enableExportRoutes builds from it
 * is asserted against a recording `app` double using the REAL export.config (including the
 * ENABLE_BULK_EXPORT feature gate, which is a security-relevant switch: the routes must not
 * exist at all when bulk export is off).
 */

const { describe, test, expect, beforeEach, afterEach, jest: jestObj } = require('@jest/globals');

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

const { routes: exportRoutes } = require('../../../../../middleware/fhir/export/export.config');
const { routeArgs } = require('../../../../../middleware/fhir/route.config');
const { VERSIONS } = require('../../../../../middleware/fhir/utils/constants');
const { FhirRouter } = require('../../../../../middleware/fhir/router');
const { ControllerUtils } = require('../../../../../middleware/fhir/controller.utils');
const { CustomOperationsController } = require('../../../../../middleware/fhir/4_0_0/controllers/operations.controller');

const EXPRESS_METHODS = ['get', 'post', 'put', 'patch', 'delete'];

function registerExportRoutes () {
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

    const router = new FhirRouter({ controllerUtils, customOperationsController });
    router.enableExportRoutes(app, { auth: { strategy: { name: 'jwt' } }, profiles: {} }, {});
    return { registrations, customOperationsController };
}

describe('export.config — route table shape', () => {
    test('declares exactly the four documented bulk-export endpoints', () => {
        expect(exportRoutes).toHaveLength(4);
        expect(exportRoutes.map((r) => `${r.method} ${r.path}`)).toEqual([
            'GET /:base_version/$export/:id',
            'POST /:base_version/$export',
            'POST /:base_version/Patient/$export',
            'GET /:base_version/Group/:id/$export'
        ]);
    });

    test('every entry uses an uppercase HTTP verb that express can dispatch', () => {
        for (const route of exportRoutes) {
            expect(route.method).toBe(route.method.toUpperCase());
            expect(EXPRESS_METHODS).toContain(route.method.toLowerCase());
        }
    });

    test('corsOptions.methods always matches the declared verb', () => {
        const mismatches = exportRoutes
            .filter((r) => !r.corsOptions || r.corsOptions.methods.join(',') !== r.method)
            .map((r) => `${r.method} ${r.path}`);
        expect(mismatches).toEqual([]);
    });

    test('routes with an :id segment declare the shared ID routeArg, and only those', () => {
        for (const route of exportRoutes) {
            const declaresId = route.args.includes(routeArgs.ID);
            expect(declaresId).toBe(route.path.includes('/:id'));
            // every route must declare base_version, and by shared reference not a copy
            expect(route.args[0]).toBe(routeArgs.BASE);
        }
    });

    test('every entry is pinned to the 4_0_0 base version only', () => {
        for (const route of exportRoutes) {
            expect(route.versions).toEqual([VERSIONS['4_0_0']]);
        }
    });

    test('operation names split correctly between status polling and export kick-off', () => {
        const byOperation = (name) => exportRoutes.filter((r) => r.operation === name);

        // exportById is the status/result lookup for a single previously created job
        expect(byOperation('exportById').map((r) => `${r.method} ${r.path}`))
            .toEqual(['GET /:base_version/$export/:id']);
        // the remaining three all kick off / drive an export
        expect(byOperation('export')).toHaveLength(3);
        expect(exportRoutes.every((r) => typeof r.operation === 'string' && r.operation.length > 0)).toBe(true);
    });

    test('the Group-scoped export keeps the :id segment so one group cannot export another', () => {
        const groupExport = exportRoutes.find((r) => r.path.includes('/Group/'));
        expect(groupExport.path).toBe('/:base_version/Group/:id/$export');
        expect(groupExport.args).toEqual([routeArgs.BASE, routeArgs.ID]);
    });
});

describe('export.config — middleware chain wired by FhirRouter.enableExportRoutes', () => {
    const originalFlag = process.env.ENABLE_BULK_EXPORT;

    afterEach(() => {
        if (originalFlag === undefined) {
            delete process.env.ENABLE_BULK_EXPORT;
        } else {
            process.env.ENABLE_BULK_EXPORT = originalFlag;
        }
    });

    describe('with ENABLE_BULK_EXPORT=1', () => {
        let registrations;
        let customOperationsController;

        beforeEach(() => {
            jestObj.clearAllMocks();
            process.env.ENABLE_BULK_EXPORT = '1';
            ({ registrations, customOperationsController } = registerExportRoutes());
        });

        test('registers one express route per config entry with the verb lowercased', () => {
            expect(registrations).toHaveLength(exportRoutes.length);
            expect(registrations.map((r) => `${r.method} ${r.path}`)).toEqual(
                exportRoutes.map((r) => `${r.method.toLowerCase()} ${r.path}`)
            );
        });

        test('every bulk-export route is registered with the authentication middleware in its chain', () => {
            // Bulk export streams whole-population PHI; an unauthenticated $export route is a
            // mass-disclosure hole, so this chain member is non-negotiable.
            const unauthenticated = registrations
                .filter((r) => !r.chain.includes(AUTH_MW))
                .map((r) => `${r.method.toUpperCase()} ${r.path}`);
            expect(unauthenticated).toEqual([]);
        });

        test('every bulk-export route also carries the SMART scope middleware, after authentication', () => {
            for (const registration of registrations) {
                const authIndex = registration.chain.indexOf(AUTH_MW);
                const sofIndex = registration.chain.indexOf(SOF_MW);
                expect(authIndex).toBeGreaterThanOrEqual(0);
                expect(sofIndex).toBeGreaterThan(authIndex);
            }
        });

        test('chain order is cors -> version validation -> args -> auth -> scope -> handler', () => {
            for (const registration of registrations) {
                expect(registration.chain.slice(0, 5)).toEqual([CORS_MW, VERSION_MW, ARGS_MW, AUTH_MW, SOF_MW]);
                expect(registration.chain).toHaveLength(6);
            }
        });

        test('GET entries are bound to operationsGet and POST entries to operationsPost', () => {
            expect(customOperationsController.operationsGet).toHaveBeenCalledTimes(2);
            expect(customOperationsController.operationsPost).toHaveBeenCalledTimes(2);
            expect(customOperationsController.operationsGet).toHaveBeenCalledWith({ name: 'exportById' });
            expect(customOperationsController.operationsGet).toHaveBeenCalledWith({ name: 'export' });
            expect(customOperationsController.operationsPost).toHaveBeenCalledWith({ name: 'export' });
        });
    });

    describe('feature gate', () => {
        test('no $export route exists at all when ENABLE_BULK_EXPORT is unset', () => {
            jestObj.clearAllMocks();
            delete process.env.ENABLE_BULK_EXPORT;
            const { registrations } = registerExportRoutes();
            expect(registrations).toEqual([]);
        });

        test('a non-truthy ENABLE_BULK_EXPORT value does not open the routes', () => {
            for (const value of ['0', 'false', '', 'no']) {
                jestObj.clearAllMocks();
                process.env.ENABLE_BULK_EXPORT = value;
                const { registrations } = registerExportRoutes();
                expect(registrations).toEqual([]);
            }
        });
    });
});
