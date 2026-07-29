'use strict';

const { describe, test, expect, jest: jestObj } = require('@jest/globals');

jestObj.mock('../../../../../middleware/fhir/base/base.controller', () => ({
    batch: jestObj.fn(() => 'batchHandler'),
    question: jestObj.fn(() => 'questionHandler')
}));

const { routes } = require('../../../../../middleware/fhir/base/base.config');

describe('base.config', () => {
    test('exports routes array', () => {
        expect(Array.isArray(routes)).toBe(true);
        expect(routes.length).toBeGreaterThan(0);
    });

    test('has PUT batch route', () => {
        const putRoute = routes.find(r => r.type === 'put');
        expect(putRoute).toBeDefined();
        expect(putRoute.path).toBe('/:base_version/');
        expect(putRoute.corsOptions.methods).toContain('PUT');
    });

    test('has POST batch route', () => {
        const postRoute = routes.find(r => r.type === 'post' && r.path === '/:base_version/');
        expect(postRoute).toBeDefined();
        expect(postRoute.corsOptions.methods).toContain('POST');
    });

    test('has GET batch route', () => {
        const getRoute = routes.find(r => r.type === 'get' && r.path === '/:base_version');
        expect(getRoute).toBeDefined();
    });

    test('has GET $question route', () => {
        const questionRoute = routes.find(r => r.path === '/:base_version/$question' && r.type === 'get');
        expect(questionRoute).toBeDefined();
        expect(questionRoute.corsOptions.methods).toContain('GET');
    });

    test('has POST $question route', () => {
        const questionRoute = routes.find(r => r.path === '/:base_version/$question' && r.type === 'post');
        expect(questionRoute).toBeDefined();
    });

    test('all routes have controller', () => {
        for (const route of routes) {
            expect(route.controller).toBeDefined();
        }
    });

    test('all routes have args array', () => {
        for (const route of routes) {
            expect(Array.isArray(route.args)).toBe(true);
        }
    });
});
