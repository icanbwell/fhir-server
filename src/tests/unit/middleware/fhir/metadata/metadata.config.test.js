const { describe, test, expect, jest: jestObj } = require('@jest/globals');

// Mock the controller
jestObj.mock('../../../../../middleware/fhir/metadata/metadata.controller.js', () => ({
    getCapabilityStatement: jestObj.fn()
}));

// Mock route.config.js
jestObj.mock('../../../../../middleware/fhir/route.config.js', () => ({
    routeArgs: {
        BASE: { name: 'base_version', type: 'string', conformance_hide: true },
        ID: { name: 'id', type: 'string', conformance_hide: true }
    }
}));

const { route } = require('../../../../../middleware/fhir/metadata/metadata.config.js');
const controller = require('../../../../../middleware/fhir/metadata/metadata.controller.js');

describe('metadata.config', () => {
    test('exports a route object', () => {
        expect(route).toBeDefined();
        expect(typeof route).toBe('object');
    });

    test('route has correct path', () => {
        expect(route.path).toBe('/:base_version/metadata');
    });

    test('route has corsOptions with GET method', () => {
        expect(route.corsOptions).toBeDefined();
        expect(route.corsOptions.methods).toEqual(['GET']);
    });

    test('route has args with BASE routeArg', () => {
        expect(route.args).toBeDefined();
        expect(route.args).toContainEqual({ name: 'base_version', type: 'string', conformance_hide: true });
    });

    test('route has controller set to getCapabilityStatement', () => {
        expect(route.controller).toBe(controller.getCapabilityStatement);
    });
});
