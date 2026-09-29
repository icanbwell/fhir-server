'use strict';

const { describe, test, expect, jest: jestObj } = require('@jest/globals');
const validateContentTypeMiddleware = require('../../../middleware/contentType-validation.middleware');

describe('contentType-validation.middleware', () => {
    const makeReq = (contentType) => ({
        headers: { 'content-type': contentType }
    });

    const makeRes = () => {
        const res = {};
        res.status = jestObj.fn().mockReturnValue(res);
        res.json = jestObj.fn().mockReturnValue(res);
        return res;
    };

    test('calls next() for allowed content type', () => {
        const middleware = validateContentTypeMiddleware({
            allowedContentTypes: ['application/fhir+json', 'application/json']
        });
        const next = jestObj.fn();
        middleware(makeReq('application/json'), makeRes(), next);
        expect(next).toHaveBeenCalled();
    });

    test('returns 400 for disallowed content type', () => {
        const middleware = validateContentTypeMiddleware({
            allowedContentTypes: ['application/fhir+json']
        });
        const res = makeRes();
        const next = jestObj.fn();
        middleware(makeReq('text/plain'), res, next);
        expect(res.status).toHaveBeenCalledWith(400);
        expect(next).not.toHaveBeenCalled();
    });

    test('error message includes the rejected content type', () => {
        const middleware = validateContentTypeMiddleware({
            allowedContentTypes: ['application/fhir+json']
        });
        const res = makeRes();
        middleware(makeReq('text/html'), res, jestObj.fn());
        expect(res.json).toHaveBeenCalledWith(
            expect.objectContaining({
                message: expect.stringContaining('text/html')
            })
        );
    });

    test('error message lists allowed content types', () => {
        const middleware = validateContentTypeMiddleware({
            allowedContentTypes: ['application/fhir+json', 'application/json']
        });
        const res = makeRes();
        middleware(makeReq('text/xml'), res, jestObj.fn());
        expect(res.json).toHaveBeenCalledWith(
            expect.objectContaining({
                message: expect.stringContaining('application/fhir+json,application/json')
            })
        );
    });

    test('handles content type with charset parameter', () => {
        const middleware = validateContentTypeMiddleware({
            allowedContentTypes: ['application/json']
        });
        const next = jestObj.fn();
        middleware(makeReq('application/json; charset=utf-8'), makeRes(), next);
        expect(next).toHaveBeenCalled();
    });

    test('multiple allowed types - first type passes', () => {
        const middleware = validateContentTypeMiddleware({
            allowedContentTypes: ['application/fhir+json', 'application/json', 'text/plain']
        });
        const next = jestObj.fn();
        middleware(makeReq('application/fhir+json'), makeRes(), next);
        expect(next).toHaveBeenCalled();
    });

    test('multiple allowed types - last type passes', () => {
        const middleware = validateContentTypeMiddleware({
            allowedContentTypes: ['application/fhir+json', 'application/json', 'text/plain']
        });
        const next = jestObj.fn();
        middleware(makeReq('text/plain'), makeRes(), next);
        expect(next).toHaveBeenCalled();
    });

    test('multiple allowed types - unlisted type returns 400', () => {
        const middleware = validateContentTypeMiddleware({
            allowedContentTypes: ['application/fhir+json', 'application/json', 'text/plain']
        });
        const res = makeRes();
        const next = jestObj.fn();
        middleware(makeReq('text/html'), res, next);
        expect(res.status).toHaveBeenCalledWith(400);
        expect(next).not.toHaveBeenCalled();
    });
});
