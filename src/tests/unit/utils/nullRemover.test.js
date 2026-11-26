'use strict';

const { describe, test, expect } = require('@jest/globals');
const {
    removeNull,
    removeNullFromArray,
    removeNullFromGraphQLResult
} = require('../../../utils/nullRemover');

describe('nullRemover', () => {
    describe('removeNull', () => {
        test('removes null properties', () => {
            const obj = { a: 1, b: null, c: 'hello' };
            const result = removeNull(obj);
            expect(result).toEqual({ a: 1, c: 'hello' });
        });

        test('removes undefined properties', () => {
            const obj = { a: 1, b: undefined };
            const result = removeNull(obj);
            expect(result).toEqual({ a: 1 });
        });

        test('recursively removes nulls in nested objects', () => {
            const obj = { a: { b: null, c: 1 } };
            const result = removeNull(obj);
            expect(result).toEqual({ a: { c: 1 } });
        });

        test('recursively handles arrays of objects', () => {
            const obj = { arr: [{ a: 1, b: null }, { c: null, d: 2 }] };
            const result = removeNull(obj);
            expect(result).toEqual({ arr: [{ a: 1 }, { d: 2 }] });
        });

        test('preserves Date objects', () => {
            const date = new Date('2023-01-01');
            const obj = { created: date };
            const result = removeNull(obj);
            expect(result.created).toBe(date);
        });

        test('returns primitives unchanged', () => {
            expect(removeNull('hello')).toBe('hello');
            expect(removeNull(42)).toBe(42);
            expect(removeNull(null)).toBeNull();
        });

        test('preserves empty arrays (does not remove them)', () => {
            const obj = { items: [] };
            const result = removeNull(obj);
            expect(result.items).toEqual([]);
        });

        test('preserves zero and false values', () => {
            const obj = { count: 0, active: false };
            const result = removeNull(obj);
            expect(result).toEqual({ count: 0, active: false });
        });

        test('mutates original object', () => {
            const obj = { a: null, b: 1 };
            const result = removeNull(obj);
            expect(result).toBe(obj);
        });
    });

    describe('removeNullFromArray', () => {
        test('removes null entries from arrays', () => {
            const obj = { items: [1, null, 3] };
            removeNullFromArray(obj);
            expect(obj.items).toEqual([1, 3]);
        });

        test('removes empty objects from arrays', () => {
            const obj = { items: [{ a: 1 }, {}, { b: 2 }] };
            removeNullFromArray(obj);
            expect(obj.items).toEqual([{ a: 1 }, { b: 2 }]);
        });

        test('does NOT remove null properties from objects (only from arrays)', () => {
            const obj = { a: null, b: 1 };
            removeNullFromArray(obj);
            expect(obj.a).toBeNull();
        });

        test('recursively cleans nested arrays', () => {
            const obj = { outer: { inner: [null, { x: 1 }] } };
            removeNullFromArray(obj);
            expect(obj.outer.inner).toEqual([{ x: 1 }]);
        });

        test('preserves Date objects', () => {
            const date = new Date();
            const obj = { d: date };
            removeNullFromArray(obj);
            expect(obj.d).toBe(date);
        });
    });

    describe('removeNullFromGraphQLResult', () => {
        test.each([
            ['all resolved', [{ id: '1' }, { id: '2' }], [{ id: '1' }, { id: '2' }]],
            ['some unresolved', [null, { id: '2' }, null], [null, { id: '2' }, null]],
            ['none resolved', [null, null], [null, null]],
            ['empty entity', [{}, { id: '2' }], [{}, { id: '2' }]]
        ])('keeps one _entities item per representation: %s', (_name, entities, expected) => {
            const result = removeNullFromGraphQLResult({ data: { _entities: entities } });
            expect(result.data._entities).toStrictEqual(expected);
        });

        test('still removes nulls inside entities and other arrays', () => {
            const result = removeNullFromGraphQLResult({
                data: {
                    _entities: [{ id: '1', tags: ['a', null, 'b'] }, null],
                    patient: [null, { id: '3' }]
                }
            });
            expect(result.data._entities).toStrictEqual([{ id: '1', tags: ['a', 'b'] }, null]);
            expect(result.data.patient).toStrictEqual([{ id: '3' }]);
        });

        test('behaves like removeNullFromArray without _entities', () => {
            const result = removeNullFromGraphQLResult({ data: { patient: [null, { id: '1' }] } });
            expect(result).toStrictEqual({ data: { patient: [{ id: '1' }] } });
        });

        test('returns a result without data unchanged', () => {
            expect(removeNullFromGraphQLResult({ errors: [{ message: 'x' }] })).toStrictEqual({
                errors: [{ message: 'x' }]
            });
            expect(removeNullFromGraphQLResult(null)).toBeNull();
        });
    });
});
