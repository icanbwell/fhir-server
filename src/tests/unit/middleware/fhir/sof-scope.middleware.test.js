'use strict';

const { describe, test, expect, jest: jestObj, beforeEach, afterEach } = require('@jest/globals');

jestObj.mock('@asymmetrik/sof-scope-checker', () => jestObj.fn());
jestObj.mock('../../../../middleware/fhir/utils/error.utils', () => ({
    unauthorized: jestObj.fn((msg, version) => ({ statusCode: 403, message: msg }))
}));

const sofScopeCheckMiddleware = require('../../../../middleware/fhir/sof-scope.middleware');
const scopeChecker = require('@asymmetrik/sof-scope-checker');

describe('sofScopeCheckMiddleware', () => {
    const originalEnv = process.env.NODE_ENV;

    afterEach(() => {
        process.env.NODE_ENV = originalEnv;
    });

    test('returns noop middleware in test environment', () => {
        process.env.NODE_ENV = 'test';
        const middleware = sofScopeCheckMiddleware({ auth: { type: 'smart', strategy: {} } });
        const next = jestObj.fn();
        middleware({}, {}, next);
        expect(next).toHaveBeenCalledWith();
    });

    test('returns noop middleware when auth type is not smart', () => {
        process.env.NODE_ENV = 'production';
        const middleware = sofScopeCheckMiddleware({ auth: { type: 'bearer' } });
        const next = jestObj.fn();
        middleware({}, {}, next);
        expect(next).toHaveBeenCalledWith();
    });

    test('returns noop middleware when auth strategy is undefined', () => {
        process.env.NODE_ENV = 'production';
        const middleware = sofScopeCheckMiddleware({ auth: { type: 'smart' } });
        const next = jestObj.fn();
        middleware({}, {}, next);
        expect(next).toHaveBeenCalledWith();
    });

    // DCON-4806: INTERACTIONS was imported from '../../constants' (src/constants.js), which
    // exports no INTERACTIONS key -- the destructure silently resolved to `undefined`, so
    // every `case INTERACTIONS.SEARCH` etc. threw a TypeError at request time. Fixed by
    // importing from './utils/constants', the module that actually defines INTERACTIONS.
    describe('with smart auth enabled', () => {
        beforeEach(() => {
            process.env.NODE_ENV = 'production';
        });

        test('does not throw and correctly derives a read action for a search interaction', () => {
            scopeChecker.mockReturnValue({});
            const middleware = sofScopeCheckMiddleware({
                route: { interaction: 'search' },
                name: 'patient',
                auth: { type: 'smart', strategy: {} }
            });
            const req = { user: { scope: 'patient/Patient.read' }, params: {} };
            const next = jestObj.fn();
            expect(() => middleware(req, {}, next)).not.toThrow();
            expect(scopeChecker).toHaveBeenCalledWith('Patient', 'read', ['patient/Patient.read']);
            expect(next).toHaveBeenCalledWith();
        });

        test('correctly derives a write action for a create interaction', () => {
            scopeChecker.mockReturnValue({});
            const middleware = sofScopeCheckMiddleware({
                route: { interaction: 'create' },
                name: 'patient',
                auth: { type: 'smart', strategy: {} }
            });
            const req = { user: { scope: 'patient/Patient.write' }, params: {} };
            const next = jestObj.fn();
            middleware(req, {}, next);
            expect(scopeChecker).toHaveBeenCalledWith('Patient', 'write', ['patient/Patient.write']);
        });

        test('correctly derives a write action for a patch interaction', () => {
            scopeChecker.mockReturnValue({});
            const middleware = sofScopeCheckMiddleware({
                route: { interaction: 'patch' },
                name: 'patient',
                auth: { type: 'smart', strategy: {} }
            });
            const req = { user: { scope: 'patient/Patient.write' }, params: {} };
            const next = jestObj.fn();
            middleware(req, {}, next);
            expect(scopeChecker).toHaveBeenCalledWith('Patient', 'write', ['patient/Patient.write']);
        });

        test('rejects when scopeChecker reports an authorization error', () => {
            const errors = require('../../../../middleware/fhir/utils/error.utils');
            scopeChecker.mockReturnValue({ error: { message: 'insufficient scope' } });
            const middleware = sofScopeCheckMiddleware({
                route: { interaction: 'search' },
                name: 'patient',
                auth: { type: 'smart', strategy: {} }
            });
            const req = { user: { scope: '' }, params: {} };
            const next = jestObj.fn();
            middleware(req, {}, next);
            expect(errors.unauthorized).toHaveBeenCalledWith('insufficient scope', undefined);
            expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 403 }));
        });
    });
});
