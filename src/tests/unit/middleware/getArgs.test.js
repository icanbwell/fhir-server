'use strict';

const { describe, test, expect, jest: jestObj } = require('@jest/globals');
const { getArgsMiddleware } = require('../../../middleware/fhir/utils/getArgs.utils');

describe('getArgsMiddleware', () => {
    const makeReq = (overrides = {}) => {
        const req = {
            url: '/Patient',
            method: 'GET',
            query: {},
            body: {},
            params: {},
            ...overrides
        };
        if (req.path === undefined) {
            req.path = req.url.split('?')[0];
        }
        return req;
    };

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

    test('includes body params for form-urlencoded _search POST', () => {
        const middleware = getArgsMiddleware({}, []);
        const req = makeReq({
            url: '/Patient/_search',
            method: 'POST',
            body: { name: 'Smith' },
            headers: { 'content-type': 'application/x-www-form-urlencoded' }
        });
        middleware(req, {}, jestObj.fn());
        expect(req.sanitized_args.name).toBe('Smith');
    });

    test('includes body params for form-urlencoded _search POST when a query string is present', () => {
        const middleware = getArgsMiddleware({}, []);
        const req = makeReq({
            url: '/Patient/_search?_debug=1',
            method: 'POST',
            body: { name: 'Smith' },
            query: { _debug: '1' },
            headers: { 'content-type': 'application/x-www-form-urlencoded' }
        });
        middleware(req, {}, jestObj.fn());
        expect(req.sanitized_args.name).toBe('Smith');
    });

    test('includes body params for a form-urlencoded _search POST with a charset suffix', () => {
        const middleware = getArgsMiddleware({}, []);
        const req = makeReq({
            url: '/Patient/_search',
            method: 'POST',
            body: { name: 'Smith' },
            headers: { 'content-type': 'application/x-www-form-urlencoded; charset=UTF-8' }
        });
        middleware(req, {}, jestObj.fn());
        expect(req.sanitized_args.name).toBe('Smith');
    });

    test('rejects a JSON _search POST with 415, per FHIR search spec (form-urlencoded only)', () => {
        const middleware = getArgsMiddleware({}, []);
        const req = makeReq({
            url: '/Patient/_search',
            method: 'POST',
            body: { name: 'Smith' },
            headers: { 'content-type': 'application/fhir+json' }
        });
        const next = jestObj.fn();
        middleware(req, {}, next);
        expect(req.sanitized_args).toBeUndefined();
        expect(next).toHaveBeenCalledTimes(1);
        expect(next.mock.calls[0][0].statusCode).toBe(415);
    });

    test('includes body params for a form-urlencoded _search POST with a trailing slash', () => {
        const middleware = getArgsMiddleware({}, []);
        const req = makeReq({
            url: '/Patient/_search/',
            method: 'POST',
            body: { name: 'Smith' },
            headers: { 'content-type': 'application/x-www-form-urlencoded' }
        });
        middleware(req, {}, jestObj.fn());
        expect(req.sanitized_args.name).toBe('Smith');
    });

    test('rejects a JSON _search POST with a trailing slash with 415', () => {
        const middleware = getArgsMiddleware({}, []);
        const req = makeReq({
            url: '/Patient/_search/',
            method: 'POST',
            body: { name: 'Smith' },
            headers: { 'content-type': 'application/fhir+json' }
        });
        const next = jestObj.fn();
        middleware(req, {}, next);
        expect(req.sanitized_args).toBeUndefined();
        expect(next).toHaveBeenCalledTimes(1);
        expect(next.mock.calls[0][0].statusCode).toBe(415);
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
