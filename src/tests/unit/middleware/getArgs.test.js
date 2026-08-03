'use strict';

const { describe, test, expect, jest: jestObj } = require('@jest/globals');
const { getArgsMiddleware } = require('../../../middleware/fhir/utils/getArgs.utils');

describe('getArgsMiddleware', () => {
    const makeReq = (overrides = {}) => ({
        url: '/Patient',
        method: 'GET',
        query: {},
        body: {},
        params: {},
        ...overrides
    });

    test('sets sanitized_args from query on GET', () => {
        const middleware = getArgsMiddleware({}, []);
        const req = makeReq({ query: { _count: '10', name: 'Smith' } });
        const next = jestObj.fn();
        middleware(req, {}, next);
        expect(req.sanitized_args._count).toBe('10');
        expect(req.sanitized_args.name).toBe('Smith');
        expect(next).toHaveBeenCalled();
    });

    test('does not include body params for non-search POST', () => {
        const middleware = getArgsMiddleware({}, []);
        const req = makeReq({
            url: '/Patient',
            method: 'POST',
            body: { name: 'should-not-appear' }
        });
        middleware(req, {}, jestObj.fn());
        expect(req.sanitized_args.name).toBeUndefined();
    });

    test('includes body params for _search POST', () => {
        const middleware = getArgsMiddleware({}, []);
        const req = makeReq({
            url: '/Patient/_search',
            method: 'POST',
            body: { name: 'Smith' }
        });
        middleware(req, {}, jestObj.fn());
        expect(req.sanitized_args.name).toBe('Smith');
    });

    test('includes route params', () => {
        const middleware = getArgsMiddleware({}, []);
        const req = makeReq({ params: { id: '123' } });
        middleware(req, {}, jestObj.fn());
        expect(req.sanitized_args.id).toBe('123');
    });

    test('route params override query params', () => {
        const middleware = getArgsMiddleware({}, []);
        const req = makeReq({
            query: { id: 'from-query' },
            params: { id: 'from-params' }
        });
        middleware(req, {}, jestObj.fn());
        expect(req.sanitized_args.id).toBe('from-params');
    });

    test('returns empty object when no params exist', () => {
        const middleware = getArgsMiddleware({}, []);
        const req = makeReq();
        middleware(req, {}, jestObj.fn());
        expect(req.sanitized_args).toEqual({});
    });

    test('always calls next()', () => {
        const middleware = getArgsMiddleware({}, []);
        const next = jestObj.fn();
        middleware(makeReq(), {}, next);
        expect(next).toHaveBeenCalledTimes(1);
    });
});
