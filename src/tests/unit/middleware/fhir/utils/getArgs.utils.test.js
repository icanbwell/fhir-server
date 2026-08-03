'use strict';

const { describe, test, expect, jest: jestObj } = require('@jest/globals');
const { getArgsMiddleware } = require('../../../../../middleware/fhir/utils/getArgs.utils');

describe('getArgsMiddleware', () => {
    const createReq = (overrides = {}) => ({
        url: '/Patient',
        method: 'GET',
        query: {},
        body: {},
        params: {},
        ...overrides
    });

    test('sets sanitized_args from GET query params', () => {
        const middleware = getArgsMiddleware({}, []);
        const req = createReq({ method: 'GET', query: { name: 'Smith', _count: '10' } });
        const next = jestObj.fn();

        middleware(req, {}, next);

        expect(req.sanitized_args).toEqual({ name: 'Smith', _count: '10' });
        expect(next).toHaveBeenCalled();
    });

    test('includes req.params', () => {
        const middleware = getArgsMiddleware({}, []);
        const req = createReq({
            method: 'GET',
            query: { name: 'John' },
            params: { base_version: '4_0_0', id: '123' }
        });
        const next = jestObj.fn();

        middleware(req, {}, next);

        expect(req.sanitized_args.base_version).toBe('4_0_0');
        expect(req.sanitized_args.id).toBe('123');
        expect(req.sanitized_args.name).toBe('John');
    });

    test('includes POST body for _search endpoint', () => {
        const middleware = getArgsMiddleware({}, []);
        const req = createReq({
            url: '/Patient/_search',
            method: 'POST',
            body: { name: 'Smith' },
            query: {}
        });
        const next = jestObj.fn();

        middleware(req, {}, next);

        expect(req.sanitized_args.name).toBe('Smith');
    });

    test('ignores POST body for non-search endpoint', () => {
        const middleware = getArgsMiddleware({}, []);
        const req = createReq({
            url: '/Patient',
            method: 'POST',
            body: { resourceType: 'Patient', name: [{ family: 'Smith' }] },
            query: {}
        });
        const next = jestObj.fn();

        middleware(req, {}, next);

        expect(req.sanitized_args.resourceType).toBeUndefined();
    });

    test('ignores GET query when empty', () => {
        const middleware = getArgsMiddleware({}, []);
        const req = createReq({ method: 'GET', query: {} });
        const next = jestObj.fn();

        middleware(req, {}, next);

        expect(req.sanitized_args).toEqual({});
    });

    test('params override query values', () => {
        const middleware = getArgsMiddleware({}, []);
        const req = createReq({
            method: 'GET',
            query: { id: 'from-query' },
            params: { id: 'from-params' }
        });
        const next = jestObj.fn();

        middleware(req, {}, next);

        expect(req.sanitized_args.id).toBe('from-params');
    });

    test('always calls next', () => {
        const middleware = getArgsMiddleware({}, []);
        const req = createReq({});
        const next = jestObj.fn();

        middleware(req, {}, next);

        expect(next).toHaveBeenCalledTimes(1);
    });
});
