'use strict';

const { describe, test, expect } = require('@jest/globals');
const { getNestedValueByPath, filterJsonByKeys } = require('../../../utils/object');

describe('object utilities', () => {
    describe('getNestedValueByPath', () => {
        test('returns top-level property', () => {
            expect(getNestedValueByPath({ a: 1 }, 'a')).toBe(1);
        });

        test('returns deeply nested property', () => {
            const obj = { a: { b: { c: 'deep' } } };
            expect(getNestedValueByPath(obj, 'a.b.c')).toBe('deep');
        });

        test('returns undefined for missing path', () => {
            expect(getNestedValueByPath({ a: 1 }, 'b.c')).toBeUndefined();
        });

        test('returns undefined when intermediate is null', () => {
            expect(getNestedValueByPath({ a: null }, 'a.b')).toBeUndefined();
        });

        test('uses custom separator', () => {
            const obj = { a: { b: 42 } };
            expect(getNestedValueByPath(obj, 'a/b', '/')).toBe(42);
        });

        test('handles array path input', () => {
            const obj = { x: { y: 'val' } };
            expect(getNestedValueByPath(obj, ['x', 'y'])).toBe('val');
        });

        test('returns undefined for empty object', () => {
            expect(getNestedValueByPath({}, 'a')).toBeUndefined();
        });
    });

    describe('filterJsonByKeys', () => {
        test('extracts specified top-level keys', () => {
            const obj = { a: 1, b: 2, c: 3 };
            const result = filterJsonByKeys(obj, ['a', 'c']);
            expect(result).toEqual({ a: 1, c: 3 });
        });

        test('extracts nested keys using dot notation', () => {
            const obj = { meta: { versionId: '1', lastUpdated: '2023-01-01' }, id: '123' };
            const result = filterJsonByKeys(obj, ['meta.versionId', 'id']);
            expect(result).toEqual({ meta: { versionId: '1' }, id: '123' });
        });

        test('ignores keys that do not exist in object', () => {
            const obj = { a: 1 };
            const result = filterJsonByKeys(obj, ['a', 'nonexistent']);
            expect(result).toEqual({ a: 1 });
        });

        test('returns empty object when no keys match', () => {
            const obj = { a: 1, b: 2 };
            const result = filterJsonByKeys(obj, ['x', 'y']);
            expect(result).toEqual({});
        });

        test('handles empty keys array', () => {
            const obj = { a: 1 };
            const result = filterJsonByKeys(obj, []);
            expect(result).toEqual({});
        });

        test('preserves nested object structure', () => {
            const obj = { a: { b: { c: 1, d: 2 } } };
            const result = filterJsonByKeys(obj, ['a.b.c']);
            expect(result).toEqual({ a: { b: { c: 1 } } });
        });

        test('uses custom separator', () => {
            const obj = { a: { b: 'val' } };
            const result = filterJsonByKeys(obj, ['a/b'], '/');
            expect(result).toEqual({ a: { b: 'val' } });
        });
    });
});
