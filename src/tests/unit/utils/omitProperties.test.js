'use strict';

const { describe, test, expect } = require('@jest/globals');
const { omitProperty, omitPropertyFromResource } = require('../../../utils/omitProperties');

describe('omitProperties', () => {
    describe('omitProperty', () => {
        test('removes specified key from object', () => {
            const obj = { a: 1, b: 2, c: 3 };
            const result = omitProperty(obj, 'b');
            expect(result).toEqual({ a: 1, c: 3 });
        });

        test('returns all properties when key does not exist', () => {
            const obj = { a: 1, b: 2 };
            const result = omitProperty(obj, 'z');
            expect(result).toEqual({ a: 1, b: 2 });
        });

        test('returns empty object when input has only the omitted key', () => {
            const result = omitProperty({ only: 'value' }, 'only');
            expect(result).toEqual({});
        });

        test('returns empty object for empty input', () => {
            const result = omitProperty({}, 'any');
            expect(result).toEqual({});
        });

        test('does not mutate original object', () => {
            const obj = { a: 1, b: 2 };
            omitProperty(obj, 'a');
            expect(obj).toEqual({ a: 1, b: 2 });
        });

        test('preserves nested objects by reference', () => {
            const nested = { x: 1 };
            const obj = { a: nested, b: 2 };
            const result = omitProperty(obj, 'b');
            expect(result.a).toBe(nested);
        });
    });

    describe('omitPropertyFromResource', () => {
        test('delegates to omitProperty', () => {
            const resource = { resourceType: 'Patient', id: '123', meta: {} };
            const result = omitPropertyFromResource(resource, 'meta');
            expect(result).toEqual({ resourceType: 'Patient', id: '123' });
        });
    });
});
