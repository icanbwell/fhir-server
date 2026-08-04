'use strict';

const { describe, test, expect, jest: jestObj } = require('@jest/globals');

jestObj.mock('../../../../middleware/fhir/utils/error.utils', () => ({
    notFound: jestObj.fn((msg, version) => ({ statusCode: 404, version }))
}));

const versionValidationMiddleware = require('../../../../middleware/fhir/version-validation.middleware');

describe('versionValidationMiddleware', () => {
    describe('with versions list', () => {
        const middleware = versionValidationMiddleware({ versions: ['4_0_0', '3_0_1'] });

        test('calls next() for valid version', () => {
            const req = { params: { base_version: '4_0_0' } };
            const next = jestObj.fn();
            middleware(req, {}, next);
            expect(next).toHaveBeenCalledWith();
        });

        test('calls next with error for invalid version', () => {
            const req = { params: { base_version: '2_0_0' } };
            const next = jestObj.fn();
            middleware(req, {}, next);
            expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 404 }));
        });

        test('calls next with error when no base_version param', () => {
            const req = { params: {} };
            const next = jestObj.fn();
            middleware(req, {}, next);
            expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 404 }));
        });

        test('calls next with error when params is undefined', () => {
            const req = {};
            const next = jestObj.fn();
            middleware(req, {}, next);
            expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 404 }));
        });
    });

    describe('with baseUrls list', () => {
        const middleware = versionValidationMiddleware({
            baseUrls: ['/4_0_0/Patient', '/4_0_0/Observation']
        });

        test('calls next with error when version not found in any baseUrl', () => {
            const req = { params: { base_version: '3_0_1' } };
            const next = jestObj.fn();
            middleware(req, {}, next);
            expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 404 }));
        });
    });

    describe('empty profile', () => {
        const middleware = versionValidationMiddleware({});

        test('calls next with error for any version (empty versions list)', () => {
            const req = { params: { base_version: '4_0_0' } };
            const next = jestObj.fn();
            middleware(req, {}, next);
            expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 404 }));
        });
    });
});
