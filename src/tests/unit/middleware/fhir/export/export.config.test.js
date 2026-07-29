const { describe, test, expect, jest: jestObj, beforeAll } = require('@jest/globals');

// Mock route.config.js
jestObj.mock('../../../../../middleware/fhir/route.config.js', () => ({
    routeArgs: {
        BASE: { name: 'base_version', type: 'string', conformance_hide: true },
        ID: { name: 'id', type: 'string', conformance_hide: true }
    }
}));

// Mock utils/constants.js
jestObj.mock('../../../../../middleware/fhir/utils/constants.js', () => ({
    VERSIONS: {
        '4_0_0': '4_0_0',
        '4_0_1': '4_0_1'
    }
}));

const { routes } = require('../../../../../middleware/fhir/export/export.config.js');

describe('export.config', () => {
    test('exports a routes array', () => {
        expect(Array.isArray(routes)).toBe(true);
    });

    test('has 3 routes', () => {
        expect(routes).toHaveLength(3);
    });

    describe('exportById route (GET /:base_version/$export/:id)', () => {
        let route;

        beforeAll(() => {
            route = routes[0];
        });

        test('has correct path', () => {
            expect(route.path).toBe('/:base_version/$export/:id');
        });

        test('has GET method', () => {
            expect(route.method).toBe('GET');
        });

        test('has corsOptions with GET', () => {
            expect(route.corsOptions).toEqual({ methods: ['GET'] });
        });

        test('has args with BASE and ID', () => {
            expect(route.args).toHaveLength(2);
        });

        test('has versions with 4_0_0', () => {
            expect(route.versions).toEqual(['4_0_0']);
        });

        test('has operation exportById', () => {
            expect(route.operation).toBe('exportById');
        });
    });

    describe('export route (POST /:base_version/$export)', () => {
        let route;

        beforeAll(() => {
            route = routes[1];
        });

        test('has correct path', () => {
            expect(route.path).toBe('/:base_version/$export');
        });

        test('has POST method', () => {
            expect(route.method).toBe('POST');
        });

        test('has corsOptions with POST', () => {
            expect(route.corsOptions).toEqual({ methods: ['POST'] });
        });

        test('has operation export', () => {
            expect(route.operation).toBe('export');
        });
    });

    describe('patient export route (POST /:base_version/Patient/$export)', () => {
        let route;

        beforeAll(() => {
            route = routes[2];
        });

        test('has correct path', () => {
            expect(route.path).toBe('/:base_version/Patient/$export');
        });

        test('has POST method', () => {
            expect(route.method).toBe('POST');
        });

        test('has corsOptions with POST', () => {
            expect(route.corsOptions).toEqual({ methods: ['POST'] });
        });

        test('has operation export', () => {
            expect(route.operation).toBe('export');
        });
    });

    test('all routes have required properties', () => {
        routes.forEach((route) => {
            expect(route).toHaveProperty('path');
            expect(route).toHaveProperty('method');
            expect(route).toHaveProperty('corsOptions');
            expect(route).toHaveProperty('args');
            expect(route).toHaveProperty('versions');
            expect(route).toHaveProperty('operation');
        });
    });
});
