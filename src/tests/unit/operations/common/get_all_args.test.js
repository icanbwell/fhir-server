'use strict';

const { describe, test, expect, jest: jestObj } = require('@jest/globals');

jestObj.mock('../../../../constants', () => ({
    LENIENT_SEARCH_HANDLING: 'lenient'
}));

const { get_all_args } = require('../../../../operations/common/get_all_args');

describe('get_all_args', () => {
    test('merges args with query params', () => {
        const req = { headers: {}, query: { _count: '10' } };
        const args = { base_version: '4_0_0' };

        const result = get_all_args(req, args);

        expect(result.base_version).toBe('4_0_0');
        expect(result._count).toBe('10');
    });

    test('sets handling from header', () => {
        const req = { headers: { handling: 'strict' }, query: {} };
        const args = {};

        const result = get_all_args(req, args);

        expect(result.handling).toBe('strict');
    });

    test('defaults handling to lenient', () => {
        const req = { headers: {}, query: {} };
        const args = {};

        const result = get_all_args(req, args);

        expect(result.handling).toBe('lenient');
    });

    test('query params override args', () => {
        const req = { headers: {}, query: { name: 'override' } };
        const args = { name: 'original' };

        const result = get_all_args(req, args);

        expect(result.name).toBe('override');
    });

    test('includes sanitized_args', () => {
        const req = { headers: {}, query: {}, sanitized_args: { _id: '123' } };
        const args = {};

        const result = get_all_args(req, args);

        expect(result._id).toBe('123');
    });

    test('handles null sanitized_args', () => {
        const req = { headers: {}, query: { x: '1' }, sanitized_args: undefined };
        const args = { y: '2' };

        const result = get_all_args(req, args);

        expect(result.x).toBe('1');
        expect(result.y).toBe('2');
    });

    test('returns new object without mutating inputs', () => {
        const req = { headers: {}, query: { a: '1' } };
        const args = { b: '2' };

        const result = get_all_args(req, args);

        expect(result).not.toBe(args);
        expect(result.a).toBe('1');
        expect(result.b).toBe('2');
    });
});
