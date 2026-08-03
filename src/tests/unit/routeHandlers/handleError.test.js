'use strict';

const { describe, test, expect, jest: jestObj } = require('@jest/globals');

jestObj.mock('express-http-context', () => ({
    get: jestObj.fn(() => 'req-id-123')
}));

const { handleServerError } = require('../../../routeHandlers/handleError');

describe('handleServerError', () => {
    const makeRes = (overrides = {}) => {
        const res = {
            headersSent: false,
            setHeader: jestObj.fn(),
            status: jestObj.fn().mockReturnThis(),
            json: jestObj.fn().mockReturnThis(),
            end: jestObj.fn(),
            ...overrides
        };
        return res;
    };

    test('returns OperationOutcome with 500 for generic error', () => {
        const err = new Error('Something broke');
        const res = makeRes();
        handleServerError(err, { id: 'r1' }, res, jestObj.fn());
        expect(res.status).toHaveBeenCalledWith(500);
        expect(res.json).toHaveBeenCalledWith(
            expect.objectContaining({ resourceType: 'OperationOutcome' })
        );
    });

    test('uses error.statusCode when available', () => {
        const err = new Error('Not Found');
        err.statusCode = 404;
        const res = makeRes();
        handleServerError(err, { id: 'r1' }, res, jestObj.fn());
        expect(res.status).toHaveBeenCalledWith(404);
    });

    test('hides error details for 5xx (internalError=true)', () => {
        const err = new Error('secret db connection string');
        err.statusCode = 500;
        const res = makeRes();
        handleServerError(err, { id: 'r1' }, res, jestObj.fn());
        const outcome = res.json.mock.calls[0][0];
        expect(outcome.issue[0].details.text).toBe('Internal Server Error');
        expect(outcome.issue[0].details.text).not.toContain('secret');
    });

    test('shows error details for 4xx (internalError=false)', () => {
        const err = new Error('Bad request data');
        err.statusCode = 400;
        const res = makeRes();
        handleServerError(err, { id: 'r1' }, res, jestObj.fn());
        const outcome = res.json.mock.calls[0][0];
        expect(outcome.issue[0].details.text).toContain('Bad request data');
    });

    test('sets X-Request-ID header when req.id exists', () => {
        const err = new Error('e');
        const res = makeRes();
        handleServerError(err, { id: 'r1' }, res, jestObj.fn());
        expect(res.setHeader).toHaveBeenCalledWith('X-Request-ID', 'req-id-123');
    });

    test('ends response when headersSent is true', () => {
        const err = new Error('e');
        const res = makeRes({ headersSent: true });
        handleServerError(err, { id: 'r1' }, res, jestObj.fn());
        expect(res.end).toHaveBeenCalled();
        expect(res.status).not.toHaveBeenCalled();
    });

    test('calls next() when no error and headers not sent', () => {
        const next = jestObj.fn();
        const res = makeRes();
        handleServerError(null, { id: 'r1' }, res, next);
        expect(next).toHaveBeenCalled();
        expect(res.status).not.toHaveBeenCalled();
    });
});
