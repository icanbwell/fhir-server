'use strict';

const { describe, test, expect } = require('@jest/globals');
const { get_all_args } = require('../../../../operations/common/get_all_args');

describe('get_all_args', () => {
    const makeReq = (overrides = {}) => ({
        headers: {},
        sanitized_args: {},
        query: {},
        ...overrides
    });

    test('combines args with request query params', () => {
        const req = makeReq({ query: { _count: '10' } });
        const args = { base_version: '4_0_0' };
        const result = get_all_args(req, args);
        expect(result.base_version).toBe('4_0_0');
        expect(result._count).toBe('10');
    });

    test('adds handling from headers when present', () => {
        const req = makeReq({ headers: { handling: 'strict' } });
        const args = {};
        const result = get_all_args(req, args);
        expect(result.handling).toBe('strict');
    });

    test('defaults handling to lenient when header not present', () => {
        const req = makeReq();
        const args = {};
        const result = get_all_args(req, args);
        expect(result.handling).toBe('lenient');
    });

    test('query params override args', () => {
        const req = makeReq({ query: { _count: '50' } });
        const args = { _count: '10' };
        const result = get_all_args(req, args);
        expect(result._count).toBe('50');
    });

    test('sanitized_args override args', () => {
        const req = makeReq({ sanitized_args: { id: 'sanitized-id' } });
        const args = { id: 'original-id' };
        const result = get_all_args(req, args);
        expect(result.id).toBe('sanitized-id');
    });

    test('handles null sanitized_args', () => {
        const req = makeReq({ sanitized_args: undefined });
        const args = { id: '123' };
        const result = get_all_args(req, args);
        expect(result.id).toBe('123');
    });

    test('returns new object (does not mutate args)', () => {
        const req = makeReq();
        const args = { x: 1 };
        const result = get_all_args(req, args);
        expect(result).not.toBe(args);
    });
});
