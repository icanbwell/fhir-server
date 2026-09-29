'use strict';

const { describe, test, expect } = require('@jest/globals');
const { getCircularReplacer } = require('../../../utils/getCircularReplacer');

describe('getCircularReplacer', () => {
    test('handles simple objects', () => {
        const obj = { a: 1, b: 'hello' };
        const result = JSON.stringify(obj, getCircularReplacer());
        expect(JSON.parse(result)).toEqual({ a: 1, b: 'hello' });
    });

    test('removes circular references', () => {
        const obj = { a: 1 };
        obj.self = obj;
        const result = JSON.stringify(obj, getCircularReplacer());
        const parsed = JSON.parse(result);
        expect(parsed.a).toBe(1);
        expect(parsed.self).toBeUndefined();
    });

    test('handles deeply nested circular references', () => {
        const obj = { nested: { deep: {} } };
        obj.nested.deep.back = obj;
        const result = JSON.stringify(obj, getCircularReplacer());
        const parsed = JSON.parse(result);
        expect(parsed.nested.deep.back).toBeUndefined();
    });

    test('converts RegExp to string', () => {
        const obj = { pattern: /^Patient/ };
        const result = JSON.stringify(obj, getCircularReplacer());
        const parsed = JSON.parse(result);
        expect(parsed.pattern).toBe('/^Patient/');
    });

    test('converts RegExp with flags to string', () => {
        const obj = { pattern: /test/gi };
        const result = JSON.stringify(obj, getCircularReplacer());
        const parsed = JSON.parse(result);
        expect(parsed.pattern).toBe('/test/gi');
    });

    test('handles null values', () => {
        const obj = { a: null, b: 1 };
        const result = JSON.stringify(obj, getCircularReplacer());
        const parsed = JSON.parse(result);
        expect(parsed.a).toBeNull();
        expect(parsed.b).toBe(1);
    });

    test('handles arrays', () => {
        const obj = { arr: [1, 2, 3] };
        const result = JSON.stringify(obj, getCircularReplacer());
        expect(JSON.parse(result)).toEqual({ arr: [1, 2, 3] });
    });

    test('handles arrays with circular references', () => {
        const arr = [1, 2];
        const obj = { arr, ref: arr };
        const result = JSON.stringify(obj, getCircularReplacer());
        const parsed = JSON.parse(result);
        expect(parsed.arr).toEqual([1, 2]);
        expect(parsed.ref).toBeUndefined();
    });

    test('preserves primitives (not objects)', () => {
        const obj = { str: 'hello', num: 42, bool: true };
        const result = JSON.stringify(obj, getCircularReplacer());
        expect(JSON.parse(result)).toEqual(obj);
    });
});
