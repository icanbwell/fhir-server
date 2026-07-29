const { describe, test, expect } = require('@jest/globals');

const { routes, routeArgs } = require('../../../../middleware/fhir/route.config');
const { INTERACTIONS } = require('../../../../middleware/fhir/utils/constants');

describe('route.config', () => {
    describe('routes', () => {
        test('exports an array of route configurations', () => {
            expect(Array.isArray(routes)).toBe(true);
            expect(routes.length).toBeGreaterThan(0);
        });

        test('each route has a type property', () => {
            for (const route of routes) {
                expect(route).toHaveProperty('type');
                expect(['get', 'post', 'put', 'patch', 'delete']).toContain(route.type);
            }
        });

        test('each route has a path property starting with /', () => {
            for (const route of routes) {
                expect(route).toHaveProperty('path');
                expect(route.path.startsWith('/')).toBe(true);
            }
        });

        test('each route has an interaction property defined in the config', () => {
            for (const route of routes) {
                expect(route).toHaveProperty('interaction');
            }
        });

        test('contains a PATCH route for resource by id', () => {
            const patchRoute = routes.find(
                r => r.type === 'patch' && r.path === '/:base_version/:resource/:id'
            );
            expect(patchRoute).toBeDefined();
            expect(patchRoute.interaction).toBe(INTERACTIONS.PATCH);
        });

        test('contains a GET search route for resources', () => {
            const searchRoute = routes.find(
                r => r.type === 'get' && r.path === '/:base_version/:resource' && r.interaction === INTERACTIONS.SEARCH
            );
            expect(searchRoute).toBeDefined();
        });

        test('contains a POST _search route for resources', () => {
            const searchRoute = routes.find(
                r => r.type === 'post' && r.path === '/:base_version/:resource/_search'
            );
            expect(searchRoute).toBeDefined();
            expect(searchRoute.interaction).toBe(INTERACTIONS.SEARCH);
        });

        test('contains a GET route for search by version id', () => {
            const vidRoute = routes.find(
                r => r.path === '/:base_version/:resource/:id/_history/:version_id'
            );
            expect(vidRoute).toBeDefined();
            expect(vidRoute.interaction).toBe(INTERACTIONS.SEARCH_BY_VID);
            expect(vidRoute.type).toBe('get');
        });

        test('contains a GET route for history', () => {
            const historyRoute = routes.find(
                r => r.path === '/:base_version/:resource/_history' && r.interaction === INTERACTIONS.HISTORY
            );
            expect(historyRoute).toBeDefined();
            expect(historyRoute.type).toBe('get');
        });

        test('contains a GET route for history by id', () => {
            const historyByIdRoute = routes.find(
                r => r.path === '/:base_version/:resource/:id/_history' && r.interaction === INTERACTIONS.HISTORY_BY_ID
            );
            expect(historyByIdRoute).toBeDefined();
            expect(historyByIdRoute.type).toBe('get');
        });

        test('contains a GET route for search by id', () => {
            const searchByIdRoute = routes.find(
                r => r.path === '/:base_version/:resource/:id' && r.interaction === INTERACTIONS.SEARCH_BY_ID
            );
            expect(searchByIdRoute).toBeDefined();
            expect(searchByIdRoute.type).toBe('get');
        });

        test('contains a POST route for create', () => {
            const createRoute = routes.find(
                r => r.type === 'post' && r.path === '/:base_version/:resource' && r.interaction === INTERACTIONS.CREATE
            );
            expect(createRoute).toBeDefined();
        });

        test('contains a PUT route for update', () => {
            const updateRoute = routes.find(
                r => r.type === 'put' && r.path === '/:base_version/:resource/:id'
            );
            expect(updateRoute).toBeDefined();
            expect(updateRoute.interaction).toBe(INTERACTIONS.UPDATE);
        });

        test('contains a DELETE route for resource by id', () => {
            const deleteRoute = routes.find(
                r => r.type === 'delete' && r.path === '/:base_version/:resource/:id'
            );
            expect(deleteRoute).toBeDefined();
            expect(deleteRoute.interaction).toBe(INTERACTIONS.DELETE);
        });

        test('contains bundle-level routes at base_version root', () => {
            const bundleGet = routes.find(
                r => r.type === 'get' && r.path === '/:base_version' && r.interaction === INTERACTIONS.OPERATIONS_GET
            );
            const bundlePost = routes.find(
                r => r.type === 'post' && r.path === '/:base_version' && r.interaction === INTERACTIONS.OPERATIONS_POST
            );
            expect(bundleGet).toBeDefined();
            expect(bundlePost).toBeDefined();
        });

        test('most interactions reference valid INTERACTIONS constants', () => {
            const validInteractions = Object.values(INTERACTIONS);
            const routesWithDefinedInteractions = routes.filter(r => r.interaction !== undefined);
            expect(routesWithDefinedInteractions.length).toBeGreaterThan(0);
            for (const route of routesWithDefinedInteractions) {
                expect(validInteractions).toContain(route.interaction);
            }
        });
    });

    describe('routeArgs', () => {
        test('exports an object with BASE, ID, and VERSION_ID', () => {
            expect(routeArgs).toHaveProperty('BASE');
            expect(routeArgs).toHaveProperty('ID');
            expect(routeArgs).toHaveProperty('VERSION_ID');
        });

        test('BASE has correct properties', () => {
            expect(routeArgs.BASE).toEqual({
                name: 'base_version',
                type: 'string',
                conformance_hide: true
            });
        });

        test('ID has correct properties', () => {
            expect(routeArgs.ID).toEqual({
                name: 'id',
                type: 'string',
                conformance_hide: true
            });
        });

        test('VERSION_ID has correct properties', () => {
            expect(routeArgs.VERSION_ID).toEqual({
                name: 'version_id',
                type: 'string',
                conformance_hide: true
            });
        });

        test('all routeArgs have conformance_hide set to true', () => {
            for (const key of Object.keys(routeArgs)) {
                expect(routeArgs[key].conformance_hide).toBe(true);
            }
        });
    });
});
