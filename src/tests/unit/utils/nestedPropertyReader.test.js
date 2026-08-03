'use strict';

const { describe, test, expect } = require('@jest/globals');
const { NestedPropertyReader } = require('../../../utils/nestedPropertyReader');

describe('NestedPropertyReader', () => {
    describe('getNestedProperty', () => {
        test('returns top-level property', () => {
            const obj = { name: 'Alice' };
            expect(NestedPropertyReader.getNestedProperty({ obj, path: 'name' })).toBe('Alice');
        });

        test('returns deeply nested property', () => {
            const obj = { a: { b: { c: 42 } } };
            expect(NestedPropertyReader.getNestedProperty({ obj, path: 'a.b.c' })).toBe(42);
        });

        test('returns undefined for missing intermediate path', () => {
            const obj = { a: { x: 1 } };
            expect(NestedPropertyReader.getNestedProperty({ obj, path: 'a.b.c' })).toBeUndefined();
        });

        test('returns undefined when obj is null', () => {
            expect(NestedPropertyReader.getNestedProperty({ obj: null, path: 'a' })).toBeUndefined();
        });

        test('returns undefined when path is empty string', () => {
            expect(NestedPropertyReader.getNestedProperty({ obj: { a: 1 }, path: '' })).toBeUndefined();
        });

        test('returns undefined when path is null', () => {
            expect(NestedPropertyReader.getNestedProperty({ obj: { a: 1 }, path: null })).toBeUndefined();
        });

        test('handles array of objects at root - collects matching values', () => {
            const obj = [
                { name: 'Alice' },
                { name: 'Bob' }
            ];
            expect(NestedPropertyReader.getNestedProperty({ obj, path: 'name' })).toEqual(['Alice', 'Bob']);
        });

        test('handles array of objects with nested paths', () => {
            const obj = [
                { meta: { source: 'a' } },
                { meta: { source: 'b' } }
            ];
            expect(NestedPropertyReader.getNestedProperty({ obj, path: 'meta.source' })).toEqual(['a', 'b']);
        });

        test('flattens nested arrays in results', () => {
            const obj = [
                { tags: ['x', 'y'] },
                { tags: ['z'] }
            ];
            const result = NestedPropertyReader.getNestedProperty({ obj, path: 'tags' });
            expect(result).toEqual(['x', 'y', 'z']);
        });

        test('skips items in array where path does not exist', () => {
            const obj = [
                { name: 'Alice' },
                { age: 30 },
                { name: 'Charlie' }
            ];
            expect(NestedPropertyReader.getNestedProperty({ obj, path: 'name' })).toEqual(['Alice', 'Charlie']);
        });

        test('returns undefined when no items in array match path', () => {
            const obj = [{ x: 1 }, { y: 2 }];
            expect(NestedPropertyReader.getNestedProperty({ obj, path: 'name' })).toBeUndefined();
        });

        test('handles nested object with array intermediate', () => {
            const obj = { entries: [{ id: '1' }, { id: '2' }] };
            expect(NestedPropertyReader.getNestedProperty({ obj, path: 'entries' })).toEqual([{ id: '1' }, { id: '2' }]);
        });
    });
});
