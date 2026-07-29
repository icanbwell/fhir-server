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

const { routes } = require('../../../../../middleware/fhir/import/import.config.js');

describe('import.config', () => {
    test('exports a routes array', () => {
        expect(Array.isArray(routes)).toBe(true);
    });

    test('has 1 route', () => {
        expect(routes).toHaveLength(1);
    });

    describe('import route', () => {
        let route;

        beforeAll(() => {
            route = routes[0];
        });

        test('has correct path', () => {
            expect(route.path).toBe('/:base_version/$import');
        });

        test('has POST method', () => {
            expect(route.method).toBe('POST');
        });

        test('has corsOptions with POST', () => {
            expect(route.corsOptions).toEqual({ methods: ['POST'] });
        });

        test('has args with BASE', () => {
            expect(route.args).toHaveLength(1);
            expect(route.args[0]).toEqual({ name: 'base_version', type: 'string', conformance_hide: true });
        });

        test('has versions with 4_0_0', () => {
            expect(route.versions).toEqual(['4_0_0']);
        });

        test('has operation import', () => {
            expect(route.operation).toBe('import');
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
