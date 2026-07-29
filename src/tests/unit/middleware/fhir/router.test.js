const { describe, test, expect, beforeEach, jest } = require('@jest/globals');

// Mock modules that cause deep dependency issues
jest.mock('express-http-context', () => ({ get: jest.fn(), set: jest.fn() }));
jest.mock('cors', () => jest.fn(() => (req, res, next) => next()));
jest.mock('../../../../middleware/fhir/version-validation.middleware', () => jest.fn(() => (req, res, next) => next()));
jest.mock('../../../../middleware/fhir/authentication.middleware', () => jest.fn(() => (req, res, next) => next()));
jest.mock('../../../../middleware/fhir/sof-scope.middleware', () => jest.fn(() => (req, res, next) => next()));
jest.mock('../../../../middleware/fhir/metadata/metadata.config', () => ({
    route: { path: '/:base_version/metadata', controller: jest.fn(() => (req, res, next) => next()) }
}));
jest.mock('../../../../middleware/fhir/export/export.config', () => ({
    routes: []
}));
jest.mock('../../../../middleware/fhir/import/import.config', () => ({
    routes: []
}));
jest.mock('../../../../middleware/fhir/utils/params.utils', () => ({
    getSearchParameters: jest.fn(() => [])
}));
jest.mock('../../../../middleware/fhir/utils/getArgs.utils', () => ({
    getArgsMiddleware: jest.fn(() => (req, res, next) => next())
}));
jest.mock('../../../../middleware/fhir/base/base.config', () => ({
    routes: []
}));
jest.mock('../../../../middleware/fhir/utils/hyphen-to-camel.utils', () => jest.fn((str) => str.replace(/-([a-z])/g, (g) => g[1].toUpperCase())));

// Mock the controller.utils to prevent deep dependency chain
jest.mock('../../../../middleware/fhir/controller.utils', () => {
    class ControllerUtils {
        constructor({ genericController }) {
            this.genericController = genericController;
        }
        getController(version, resourceName) {
            return this.genericController;
        }
    }
    return { ControllerUtils };
});

// Mock CustomOperationsController to prevent deep dependency chain
jest.mock('../../../../middleware/fhir/4_0_0/controllers/operations.controller', () => {
    class CustomOperationsController {
        constructor(params) {}
        operationsPost({ name, resourceType }) { return (req, res, next) => next(); }
        operationsGet({ name, resourceType }) { return (req, res, next) => next(); }
        operationsDelete({ name, resourceType }) { return (req, res, next) => next(); }
    }
    return { CustomOperationsController };
});

// Mock route.config
jest.mock('../../../../middleware/fhir/route.config', () => ({
    routeArgs: {
        BASE: { name: 'base_version', type: 'string' },
        ID: { name: 'id', type: 'string' },
        VERSION_ID: { name: 'version_id', type: 'string' }
    },
    routes: [
        { interaction: 'search', type: 'get', path: '/:base_version/:resource', args: [] },
        { interaction: 'searchById', type: 'get', path: '/:base_version/:resource/:id', args: [] },
        { interaction: 'create', type: 'post', path: '/:base_version/:resource', args: [] },
        { interaction: 'update', type: 'put', path: '/:base_version/:resource/:id', args: [] },
        { interaction: 'remove', type: 'delete', path: '/:base_version/:resource/:id', args: [] },
        { interaction: 'patch', type: 'patch', path: '/:base_version/:resource/:id', args: [] },
        { interaction: 'operationsGet', type: 'get', path: '/:base_version/:resource', args: [] },
        { interaction: 'operationsPost', type: 'post', path: '/:base_version/:resource', args: [] },
        { interaction: 'operationsDelete', type: 'delete', path: '/:base_version/:resource', args: [] }
    ]
}));

const { FhirRouter } = require('../../../../middleware/fhir/router');
const { ControllerUtils } = require('../../../../middleware/fhir/controller.utils');
const { CustomOperationsController } = require('../../../../middleware/fhir/4_0_0/controllers/operations.controller');

describe('FhirRouter', () => {
    let router;
    let mockControllerUtils;
    let mockCustomOperationsController;

    beforeEach(() => {
        jest.clearAllMocks();

        mockControllerUtils = Object.create(ControllerUtils.prototype);
        mockControllerUtils.getController = jest.fn();

        mockCustomOperationsController = Object.create(CustomOperationsController.prototype);
        mockCustomOperationsController.operationsPost = jest.fn(() => (req, res, next) => next());
        mockCustomOperationsController.operationsGet = jest.fn(() => (req, res, next) => next());
        mockCustomOperationsController.operationsDelete = jest.fn(() => (req, res, next) => next());

        router = new FhirRouter({
            controllerUtils: mockControllerUtils,
            customOperationsController: mockCustomOperationsController
        });
    });

    describe('getAllConfiguredVersions', () => {
        test('should return empty array for empty profiles', () => {
            const result = router.getAllConfiguredVersions({});
            expect(result).toEqual([]);
        });

        test('should return empty array when called with no arguments', () => {
            const result = router.getAllConfiguredVersions();
            expect(result).toEqual([]);
        });

        test('should return supported versions only', () => {
            const profiles = {
                Patient: { versions: ['4_0_0'] },
                Observation: { versions: ['4_0_0'] }
            };
            const result = router.getAllConfiguredVersions(profiles);
            expect(result).toContain('4_0_0');
        });

        test('should filter out unsupported versions', () => {
            const profiles = {
                Patient: { versions: ['4_0_0', '99_0_0'] }
            };
            const result = router.getAllConfiguredVersions(profiles);
            expect(result).toContain('4_0_0');
            expect(result).not.toContain('99_0_0');
        });

        test('should deduplicate versions across profiles via Set', () => {
            const profiles = {
                Patient: { versions: ['4_0_0'] },
                Observation: { versions: ['4_0_0'] }
            };
            const result = router.getAllConfiguredVersions(profiles);
            const uniqueResult = [...new Set(result)];
            expect(result.length).toBe(uniqueResult.length);
        });

        test('should handle profile without versions property - defaults to empty array', () => {
            const profiles = {
                Patient: {}
            };
            const result = router.getAllConfiguredVersions(profiles);
            expect(result).toEqual([]);
        });

        test('should handle null profiles value', () => {
            // BUG: passing null will crash since Object.getOwnPropertyNames(null) throws
            expect(() => router.getAllConfiguredVersions(null)).toThrow();
        });
    });

    describe('loadController', () => {
        test('should return a middleware function', () => {
            const middleware = router.loadController('patient', 'search', {}, 'Patient');
            expect(typeof middleware).toBe('function');
        });

        test('should call next with NotFoundError when interaction does not exist on controller', async () => {
            const mockController = {};
            mockControllerUtils.getController.mockReturnValue(mockController);

            const middleware = router.loadController('patient', 'nonexistent', {}, 'Patient');
            const req = { params: { base_version: '4_0_0' } };
            const res = {};
            const next = jest.fn();

            await middleware(req, res, next);

            expect(next).toHaveBeenCalledWith(expect.objectContaining({
                message: 'Route not found'
            }));
        });

        test('should call controller interaction when it exists', async () => {
            const innerMiddleware = jest.fn();
            const mockInteraction = jest.fn(() => innerMiddleware);
            const mockController = { search: mockInteraction };
            mockControllerUtils.getController.mockReturnValue(mockController);

            const middleware = router.loadController('patient', 'search', {}, 'Patient');
            const req = { params: { base_version: '4_0_0' } };
            const res = {};
            const next = jest.fn();

            await middleware(req, res, next);

            expect(mockInteraction).toHaveBeenCalled();
            expect(innerMiddleware).toHaveBeenCalledWith(req, res, next);
        });

        test('should use VERSIONS fallback when base_version is not in VERSIONS map', async () => {
            const innerMiddleware = jest.fn();
            const mockInteraction = jest.fn(() => innerMiddleware);
            const mockController = { search: mockInteraction };
            mockControllerUtils.getController.mockReturnValue(mockController);

            const middleware = router.loadController('patient', 'search', {}, 'Patient');
            const req = { params: { base_version: 'unknown_version' } };
            const res = {};
            const next = jest.fn();

            await middleware(req, res, next);

            // Should still work - falls back to VERSIONS['4_0_1']
            expect(mockControllerUtils.getController).toHaveBeenCalled();
        });

        test('should throw TypeError when req.params is undefined (BUG: no null guard)', async () => {
            // BUG: loadController destructures req.params without checking if params exists
            // Line 113: `const { base_version } = req.params;`
            // If express somehow fails to populate params, this crashes the middleware
            const mockController = { search: jest.fn(() => jest.fn()) };
            mockControllerUtils.getController.mockReturnValue(mockController);

            const middleware = router.loadController('patient', 'search', {}, 'Patient');
            const req = {}; // No params property
            const res = {};
            const next = jest.fn();

            // This demonstrates the bug - unguarded property access
            await expect(async () => {
                await middleware(req, res, next);
            }).rejects.toThrow(TypeError);
        });

        test('should handle undefined base_version gracefully (fallback path)', async () => {
            const innerMiddleware = jest.fn();
            const mockInteraction = jest.fn(() => innerMiddleware);
            const mockController = { search: mockInteraction };
            mockControllerUtils.getController.mockReturnValue(mockController);

            const middleware = router.loadController('patient', 'search', {}, 'Patient');
            const req = { params: {} }; // base_version is undefined
            const res = {};
            const next = jest.fn();

            await middleware(req, res, next);

            // VERSIONS[undefined] => undefined, so fallback to VERSIONS['4_0_1']
            expect(mockControllerUtils.getController).toHaveBeenCalled();
        });

        test('BUG: controller is undefined when getController returns undefined - crashes with TypeError', async () => {
            // BUG: ControllerUtils.getController only handles '4_0_0' in its switch.
            // The fallback version VERSIONS['4_0_1'] = '4_0_1' is NOT handled,
            // so getController returns undefined.
            // Then `controller[interaction]` at line 119 throws:
            //   TypeError: Cannot read properties of undefined (reading 'search')
            // This affects custom baseUrl routes that skip version validation.
            mockControllerUtils.getController.mockReturnValue(undefined);

            const middleware = router.loadController('patient', 'search', {}, 'Patient');
            const req = { params: { base_version: 'custom' } }; // triggers fallback to 4_0_1
            const res = {};
            const next = jest.fn();

            // The unguarded access to `controller[interaction]` crashes
            await expect(async () => {
                await middleware(req, res, next);
            }).rejects.toThrow(TypeError);
        });
    });

    describe('enableOperationRoutesForProfile', () => {
        let mockApp;

        beforeEach(() => {
            mockApp = {
                options: jest.fn(),
                get: jest.fn(),
                post: jest.fn(),
                delete: jest.fn()
            };
        });

        test('should throw error when operation is missing name', () => {
            const config = { auth: {} };
            const profile = {
                operation: [{ route: '/$op', method: 'GET' }]
            };

            expect(() => {
                router.enableOperationRoutesForProfile(mockApp, config, profile, 'Patient', {});
            }).toThrow('Invalid operation configuration');
        });

        test('should throw error when operation is missing route', () => {
            const config = { auth: {} };
            const profile = {
                operation: [{ name: 'myOp', method: 'GET' }]
            };

            expect(() => {
                router.enableOperationRoutesForProfile(mockApp, config, profile, 'Patient', {});
            }).toThrow('Invalid operation configuration');
        });

        test('should throw error when operation is missing method', () => {
            const config = { auth: {} };
            const profile = {
                operation: [{ name: 'myOp', route: '/$op' }]
            };

            expect(() => {
                router.enableOperationRoutesForProfile(mockApp, config, profile, 'Patient', {});
            }).toThrow('Invalid operation configuration');
        });

        test('should register GET operation with hyphen-to-camelcase conversion', () => {
            const config = { auth: {} };
            const profile = {
                operation: [{ name: 'my-op', route: '/$my-op', method: 'GET' }]
            };

            router.enableOperationRoutesForProfile(mockApp, config, profile, 'Patient', {});

            expect(mockApp.get).toHaveBeenCalled();
            expect(mockCustomOperationsController.operationsGet).toHaveBeenCalledWith({
                name: 'myOp',
                resourceType: 'Patient'
            });
        });

        test('should register POST operation routes', () => {
            const config = { auth: {} };
            const profile = {
                operation: [{ name: 'my-op', route: '/$my-op', method: 'POST' }]
            };

            router.enableOperationRoutesForProfile(mockApp, config, profile, 'Patient', {});

            expect(mockApp.post).toHaveBeenCalled();
            expect(mockCustomOperationsController.operationsPost).toHaveBeenCalledWith({
                name: 'myOp',
                resourceType: 'Patient'
            });
        });

        test('should register DELETE operation routes', () => {
            const config = { auth: {} };
            const profile = {
                operation: [{ name: 'my-op', route: '/$my-op', method: 'DELETE' }]
            };

            router.enableOperationRoutesForProfile(mockApp, config, profile, 'Patient', {});

            expect(mockApp.delete).toHaveBeenCalled();
            expect(mockCustomOperationsController.operationsDelete).toHaveBeenCalledWith({
                name: 'myOp',
                resourceType: 'Patient'
            });
        });

        test('should register additional base route when baseUrls includes /', () => {
            const config = { auth: {} };
            const profile = {
                operation: [{ name: 'my-op', route: '/$my-op', method: 'GET' }],
                baseUrls: ['/']
            };

            router.enableOperationRoutesForProfile(mockApp, config, profile, 'Patient', {});

            // Two routes: one for base URL and one for standard path
            expect(mockApp.get.mock.calls.length).toBe(2);
        });

        test('should handle empty operation name (empty string is falsy)', () => {
            const config = { auth: {} };
            const profile = {
                operation: [{ name: '', route: '/$op', method: 'GET' }]
            };

            // Empty string is falsy so !op.name is true
            expect(() => {
                router.enableOperationRoutesForProfile(mockApp, config, profile, 'Patient', {});
            }).toThrow('Invalid operation configuration');
        });
    });

    describe('enableProfileRoutes', () => {
        let mockApp;

        beforeEach(() => {
            mockApp = {
                options: jest.fn(),
                get: jest.fn(),
                post: jest.fn(),
                put: jest.fn(),
                patch: jest.fn(),
                delete: jest.fn()
            };
        });

        test('should call enableOperationRoutesForProfile when profile has operations', () => {
            const spy = jest.spyOn(router, 'enableOperationRoutesForProfile').mockImplementation(() => {});
            const config = { auth: {} };
            const profile = {
                operation: [{ name: 'my-op', route: '/$op', method: 'GET' }]
            };

            router.enableProfileRoutes(mockApp, config, profile, 'Patient', {});

            expect(spy).toHaveBeenCalledWith(mockApp, config, profile, 'Patient', {});
        });

        test('should not call enableOperationRoutesForProfile when profile has no operations', () => {
            const spy = jest.spyOn(router, 'enableOperationRoutesForProfile').mockImplementation(() => {});
            const config = { auth: {} };
            const profile = {};

            router.enableProfileRoutes(mockApp, config, profile, 'Patient', {});

            expect(spy).not.toHaveBeenCalled();
        });

        test('should not call enableOperationRoutesForProfile when operations array is empty', () => {
            const spy = jest.spyOn(router, 'enableOperationRoutesForProfile').mockImplementation(() => {});
            const config = { auth: {} };
            const profile = { operation: [] };

            router.enableProfileRoutes(mockApp, config, profile, 'Patient', {});

            expect(spy).not.toHaveBeenCalled();
        });
    });

    describe('setRoutes', () => {
        test('should throw when options is empty (config is undefined)', () => {
            // BUG: setRoutes defaults to {}, then destructures config which is undefined
            // then tries to get server from undefined config -> TypeError
            expect(() => {
                router.setRoutes();
            }).toThrow();
        });

        test('should throw when config has no server property', () => {
            const mockApp = { options: jest.fn(), get: jest.fn() };
            // BUG: `const { server } = config` gives server=undefined
            // then `Object.assign({}, server.corsOptions)` crashes
            expect(() => {
                router.setRoutes({ app: mockApp, config: {} });
            }).toThrow();
        });

        test('should work with valid minimal config', () => {
            const mockApp = {
                options: jest.fn(),
                get: jest.fn(),
                post: jest.fn(),
                put: jest.fn(),
                patch: jest.fn(),
                delete: jest.fn()
            };
            const config = {
                server: {},
                profiles: {},
                auth: {}
            };

            expect(() => {
                router.setRoutes({ app: mockApp, config });
            }).not.toThrow();
        });
    });

    describe('enableResourceRoutes', () => {
        let mockApp;

        beforeEach(() => {
            mockApp = {
                options: jest.fn(),
                get: jest.fn(),
                post: jest.fn(),
                put: jest.fn(),
                patch: jest.fn(),
                delete: jest.fn()
            };
        });

        test('should throw for profile with null versions', () => {
            const config = {
                profiles: {
                    BadResource: {
                        versions: null
                    }
                },
                auth: {}
            };

            // versions.reduce will throw since versions is null
            expect(() => {
                router.enableResourceRoutes(mockApp, config, {});
            }).toThrow();
        });

        test('should register routes for each configured profile', () => {
            const config = {
                profiles: {
                    Patient: {
                        versions: ['4_0_0'],
                        serviceModule: {}
                    }
                },
                auth: {}
            };

            router.enableResourceRoutes(mockApp, config, {});

            // Should register routes for all interactions
            expect(mockApp.get).toHaveBeenCalled();
            expect(mockApp.post).toHaveBeenCalled();
        });

        test('should skip version validation when baseUrls includes /', () => {
            const versionValidationMiddleware = require('../../../../middleware/fhir/version-validation.middleware');
            const config = {
                profiles: {
                    Patient: {
                        versions: ['4_0_0'],
                        serviceModule: {},
                        baseUrls: ['/']
                    }
                },
                auth: {}
            };

            router.enableResourceRoutes(mockApp, config, {});

            // When baseUrls includes '/', versionValidationMiddleware should NOT be in the route
            // (routes registered via the baseUrls path don't use version validation)
            const getCallArgs = mockApp.get.mock.calls[0];
            // The path should not contain ':base_version'
            expect(getCallArgs[0]).not.toContain(':base_version');
        });
    });

    describe('enableMetadataRoute', () => {
        let mockApp;

        beforeEach(() => {
            mockApp = {
                options: jest.fn(),
                get: jest.fn()
            };
        });

        test('should register metadata route for custom baseUrl profiles', () => {
            const config = {
                profiles: {
                    Patient: {
                        versions: ['4_0_0'],
                        baseUrls: ['/custom']
                    }
                },
                auth: {}
            };

            router.enableMetadataRoute(mockApp, config, {});

            expect(mockApp.get).toHaveBeenCalled();
            const path = mockApp.get.mock.calls[0][0];
            expect(path).toBe('/custom/metadata');
        });

        test('should handle baseUrl of / correctly', () => {
            const config = {
                profiles: {
                    Patient: {
                        versions: ['4_0_0'],
                        baseUrls: ['/']
                    }
                },
                auth: {}
            };

            router.enableMetadataRoute(mockApp, config, {});

            expect(mockApp.get).toHaveBeenCalled();
            const path = mockApp.get.mock.calls[0][0];
            expect(path).toBe('/metadata');
        });

        test('should register standard metadata route for inferred profiles', () => {
            const { route: metadataConfig } = require('../../../../middleware/fhir/metadata/metadata.config');
            const config = {
                profiles: {
                    Patient: {
                        versions: ['4_0_0']
                        // no baseUrls
                    }
                },
                auth: {}
            };

            router.enableMetadataRoute(mockApp, config, {});

            expect(mockApp.get).toHaveBeenCalled();
            const path = mockApp.get.mock.calls[0][0];
            expect(path).toBe(metadataConfig.path);
        });
    });
});
