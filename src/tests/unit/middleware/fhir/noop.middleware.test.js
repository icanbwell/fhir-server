'use strict';

const { describe, test, expect, jest: jestObj } = require('@jest/globals');
const noopMiddleware = require('../../../../middleware/fhir/noop.middleware');

describe('noopMiddleware', () => {
    test('calls next()', () => {
        const next = jestObj.fn();
        noopMiddleware({}, {}, next);
        expect(next).toHaveBeenCalledTimes(1);
    });

    test('calls next with no arguments', () => {
        const next = jestObj.fn();
        noopMiddleware({}, {}, next);
        expect(next).toHaveBeenCalledWith();
    });

    test('does not modify req or res', () => {
        const req = { headers: {} };
        const res = { statusCode: 200 };
        const next = jestObj.fn();
        noopMiddleware(req, res, next);
        expect(req).toEqual({ headers: {} });
        expect(res).toEqual({ statusCode: 200 });
    });
});
