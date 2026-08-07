'use strict';

const { describe, test, expect, jest: jestObj } = require('@jest/globals');
const { graphqlErrorFormatter } = require('../../../../middleware/graphql/graphqlErrorFormatter');

describe('graphqlErrorFormatter', () => {
    const createRes = () => {
        const res = { headersSent: false };
        res.status = jestObj.fn().mockReturnValue(res);
        res.json = jestObj.fn().mockReturnValue(res);
        return res;
    };

    test('returns UNAUTHENTICATED for 401 errors', () => {
        const err = new Error('Not authenticated');
        err.statusCode = 401;
        const res = createRes();
        const next = jestObj.fn();

        graphqlErrorFormatter(err, {}, res, next);

        expect(res.status).toHaveBeenCalledWith(401);
        expect(res.json).toHaveBeenCalledWith({
            errors: [{ message: 'Not authenticated', extensions: { code: 'UNAUTHENTICATED' } }]
        });
        expect(next).not.toHaveBeenCalled();
    });

    test('returns FORBIDDEN for 403 errors', () => {
        const err = new Error('Forbidden');
        err.statusCode = 403;
        const res = createRes();
        const next = jestObj.fn();

        graphqlErrorFormatter(err, {}, res, next);

        expect(res.status).toHaveBeenCalledWith(403);
        expect(res.json).toHaveBeenCalledWith({
            errors: [{ message: 'Forbidden', extensions: { code: 'FORBIDDEN' } }]
        });
    });

    test('returns INTERNAL_SERVER_ERROR for 500 errors', () => {
        const err = new Error('Something broke');
        err.statusCode = 500;
        const res = createRes();
        const next = jestObj.fn();

        graphqlErrorFormatter(err, {}, res, next);

        expect(res.status).toHaveBeenCalledWith(500);
        // The underlying error message must be redacted for 5xx responses so
        // internal implementation details are never leaked to GraphQL callers.
        expect(res.json).toHaveBeenCalledWith({
            errors: [{ message: 'Internal server error', extensions: { code: 'INTERNAL_SERVER_ERROR' } }]
        });
    });

    test('defaults to 500 when no statusCode', () => {
        const err = new Error('Unknown');
        const res = createRes();
        const next = jestObj.fn();

        graphqlErrorFormatter(err, {}, res, next);

        expect(res.status).toHaveBeenCalledWith(500);
    });

    test('defaults message to "Internal server error" when err.message is empty', () => {
        const err = new Error('');
        const res = createRes();
        const next = jestObj.fn();

        graphqlErrorFormatter(err, {}, res, next);

        expect(res.json).toHaveBeenCalledWith({
            errors: [{ message: 'Internal server error', extensions: { code: 'INTERNAL_SERVER_ERROR' } }]
        });
    });

    test('calls next(err) when headers already sent', () => {
        const err = new Error('Late error');
        const res = createRes();
        res.headersSent = true;
        const next = jestObj.fn();

        graphqlErrorFormatter(err, {}, res, next);

        expect(next).toHaveBeenCalledWith(err);
        expect(res.status).not.toHaveBeenCalled();
    });
});
