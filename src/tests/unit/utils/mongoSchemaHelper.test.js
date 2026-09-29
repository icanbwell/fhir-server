'use strict';

const { describe, test, expect, jest: jestObj } = require('@jest/globals');

jestObj.mock('../../../operations/common/logging', () => ({
    logInfo: jestObj.fn()
}));

const { getSchemaOfMongoDocument } = require('../../../utils/mongoSchemaHelper');

describe('getSchemaOfMongoDocument', () => {
    test('returns flat schema for simple object', () => {
        const obj = { name: 'Alice', age: 30 };
        const result = getSchemaOfMongoDocument('', obj, '');
        expect(result.name).toBe('string');
        expect(result.age).toBe('number');
    });

    test('handles nested objects with prefix', () => {
        const obj = { meta: { versionId: '1' } };
        const result = getSchemaOfMongoDocument('', obj, '');
        expect(result.meta).toBe('object');
        expect(result['meta.versionId']).toBe('string');
    });

    test('identifies Date type', () => {
        const obj = { created: new Date() };
        const result = getSchemaOfMongoDocument('', obj, '');
        expect(result.created).toBe('Date');
    });

    test('identifies Array type', () => {
        const obj = { items: [1, 2, 3] };
        const result = getSchemaOfMongoDocument('', obj, '');
        expect(result.items).toBe('Array');
    });

    test('handles boolean properties', () => {
        const obj = { active: true };
        const result = getSchemaOfMongoDocument('', obj, '');
        expect(result.active).toBe('boolean');
    });

    test('uses prefix in key names', () => {
        const obj = { id: '123' };
        const result = getSchemaOfMongoDocument('resource', obj, '');
        expect(result['resource.id']).toBe('string');
    });

    test('does not include functions', () => {
        const obj = { name: 'test', toJSON: () => {} };
        const result = getSchemaOfMongoDocument('', obj, '');
        expect(result.name).toBe('string');
        expect(result.toJSON).toBeUndefined();
    });

    test('handles empty object', () => {
        const result = getSchemaOfMongoDocument('', {}, '');
        expect(result).toEqual({});
    });
});
