'use strict';

const { describe, test, expect, jest: jestObj } = require('@jest/globals');
const { getArgsMiddleware } = require('../../../../../middleware/fhir/utils/getArgs.utils');

describe('getArgsMiddleware', () => {
    const createReq = (overrides = {}) => {
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

    test('includes POST body for form-urlencoded _search endpoint', () => {
        const middleware = getArgsMiddleware({}, []);
        const req = createReq({
            url: '/Patient/_search',
            method: 'POST',
            body: { name: 'Smith' },
            query: {},
            headers: { 'content-type': 'application/x-www-form-urlencoded' }
        });
        const next = jestObj.fn();

        middleware(req, {}, next);

        expect(req.sanitized_args.name).toBe('Smith');
    });

    test('includes POST body for form-urlencoded _search endpoint when a query string is present', () => {
        const middleware = getArgsMiddleware({}, []);
        const req = createReq({
            url: '/Patient/_search?_debug=1',
            method: 'POST',
            body: { name: 'Smith' },
            query: { _debug: '1' },
            headers: { 'content-type': 'application/x-www-form-urlencoded' }
        });
        const next = jestObj.fn();

        middleware(req, {}, next);

        expect(req.sanitized_args.name).toBe('Smith');
    });

    test('rejects POST body for a JSON _search endpoint with 415, per FHIR search spec (form-urlencoded only)', () => {
        const middleware = getArgsMiddleware({}, []);
        const req = createReq({
            url: '/Patient/_search',
            method: 'POST',
            body: { name: 'Smith' },
            query: {},
            headers: { 'content-type': 'application/fhir+json' }
        });
        const next = jestObj.fn();

        middleware(req, {}, next);

        expect(req.sanitized_args).toBeUndefined();
        expect(next).toHaveBeenCalledTimes(1);
        const err = next.mock.calls[0][0];
        expect(err).toBeDefined();
        expect(err.statusCode).toBe(415);
    });

    test('includes POST body for form-urlencoded _search endpoint with a trailing slash', () => {
        const middleware = getArgsMiddleware({}, []);
        const req = createReq({
            url: '/Patient/_search/',
            method: 'POST',
            body: { name: 'Smith' },
            query: {},
            headers: { 'content-type': 'application/x-www-form-urlencoded' }
        });
        const next = jestObj.fn();

        middleware(req, {}, next);

        expect(req.sanitized_args.name).toBe('Smith');
    });

    test('rejects POST body for a JSON _search endpoint with a trailing slash with 415', () => {
        const middleware = getArgsMiddleware({}, []);
        const req = createReq({
            url: '/Patient/_search/',
            method: 'POST',
            body: { name: 'Smith' },
            query: {},
            headers: { 'content-type': 'application/fhir+json' }
        });
        const next = jestObj.fn();

        middleware(req, {}, next);

        expect(req.sanitized_args).toBeUndefined();
        expect(next).toHaveBeenCalledTimes(1);
        expect(next.mock.calls[0][0].statusCode).toBe(415);
    });

    test('includes POST body for a form-urlencoded _search endpoint with a charset suffix', () => {
        const middleware = getArgsMiddleware({}, []);
        const req = createReq({
            url: '/Patient/_search',
            method: 'POST',
            body: { name: 'Smith' },
            query: {},
            headers: { 'content-type': 'application/x-www-form-urlencoded; charset=UTF-8' }
        });
        const next = jestObj.fn();

        middleware(req, {}, next);

        expect(req.sanitized_args.name).toBe('Smith');
    });

    test('does not treat an update-by-id whose id ends in "_search" as the _search endpoint', () => {
        const middleware = getArgsMiddleware({}, []);
        const req = createReq({
            url: '/4_0_0/Patient/provider_search',
            method: 'PUT',
            body: { resourceType: 'Patient', id: 'provider_search' },
            params: { id: 'provider_search' },
            query: {},
            headers: { 'content-type': 'application/fhir+json' }
        });
        const next = jestObj.fn();

        middleware(req, {}, next);

        expect(next).toHaveBeenCalledTimes(1);
        expect(next.mock.calls[0][0]).toBeUndefined();
        expect(req.sanitized_args.resourceType).toBeUndefined();
        expect(req.sanitized_args.id).toBe('provider_search');
    });

    test('rejects POST body for a JSON _SEARCH endpoint (mixed case) with 415', () => {
        const middleware = getArgsMiddleware({}, []);
        const req = createReq({
            url: '/Patient/_SEARCH',
            method: 'POST',
            body: { name: 'Smith' },
            query: {},
            headers: { 'content-type': 'application/fhir+json' }
        });
        const next = jestObj.fn();

        middleware(req, {}, next);

        expect(req.sanitized_args).toBeUndefined();
        expect(next).toHaveBeenCalledTimes(1);
        expect(next.mock.calls[0][0].statusCode).toBe(415);
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
