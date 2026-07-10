const { describe, test, expect } = require('@jest/globals');
const { ViewResolver } = require('../../operations/sqlOnFhir/viewResolver');

describe('ViewResolver', () => {
    const resolver = new ViewResolver();
    const view = { resourceType: 'ViewDefinition', resource: 'Patient', select: [{ column: [{ name: 'id', path: 'id' }] }] };

    test('extracts view + inline resources from Parameters', () => {
        const body = {
            resourceType: 'Parameters',
            parameter: [
                { name: 'viewResource', resource: view },
                { name: 'resource', resource: { resourceType: 'Patient', id: 'p1' } },
                { name: 'resource', resource: { resourceType: 'Patient', id: 'p2' } }
            ]
        };
        const { view: v, inlineResources } = resolver.resolve({ body });
        expect(v.resource).toBe('Patient');
        expect(inlineResources.map((r) => r.id)).toEqual(['p1', 'p2']);
    });

    test('accepts a bare ViewDefinition body', () => {
        const { view: v, inlineResources } = resolver.resolve({ body: view });
        expect(v.resource).toBe('Patient');
        expect(inlineResources).toEqual([]);
    });

    test('throws when no view present', () => {
        expect(() => resolver.resolve({ body: { resourceType: 'Parameters', parameter: [] } })).toThrow(/view/i);
    });
});
