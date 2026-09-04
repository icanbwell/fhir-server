const { describe, test, expect } = require('@jest/globals');
const { SearchParameterDefinition } = require('../../../searchParameters/searchParameterTypes');

describe('SearchParameterDefinition composite support', () => {
    test('stores scopes and exposes them unchanged', () => {
        const component = new SearchParameterDefinition({ type: 'token', field: 'code', arrayField: null });
        const def = new SearchParameterDefinition({
            type: 'composite',
            scopes: [{ components: [component] }]
        });
        expect(def.type).toBe('composite');
        expect(def.scopes).toHaveLength(1);
        expect(def.scopes[0].components[0]).toBe(component);
        expect(def.scopes[0].components[0].arrayField).toBeNull();
    });

    test('arrayField defaults to null when not passed', () => {
        const component = new SearchParameterDefinition({ type: 'token', field: 'code' });
        expect(component.arrayField).toBeNull();
    });

    test('clone() deep-copies scopes and each component (including arrayField)', () => {
        const component = new SearchParameterDefinition({ type: 'token', field: 'component.code', arrayField: 'component' });
        const def = new SearchParameterDefinition({ type: 'composite', scopes: [{ components: [component] }] });
        const cloned = def.clone();
        expect(cloned).not.toBe(def);
        expect(cloned.scopes[0].components[0]).not.toBe(component);
        expect(cloned.scopes[0].components[0].field).toBe('component.code');
        expect(cloned.scopes[0].components[0].arrayField).toBe('component');
    });

    test('toJSON() includes scopes', () => {
        const component = new SearchParameterDefinition({ type: 'quantity', field: 'valueQuantity' });
        const def = new SearchParameterDefinition({ type: 'composite', scopes: [{ components: [component] }] });
        const json = def.toJSON();
        expect(json.scopes[0].components[0].field).toBe('valueQuantity');
    });
});
