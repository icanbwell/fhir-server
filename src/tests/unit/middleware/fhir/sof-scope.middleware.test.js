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

    describe('with smart auth enabled (BUG: INTERACTIONS imported from wrong module)', () => {
        beforeEach(() => {
            process.env.NODE_ENV = 'production';
        });

        test('BUG: deriveActionFromInteraction crashes because INTERACTIONS is undefined', () => {
            scopeChecker.mockReturnValue({});
            const middleware = sofScopeCheckMiddleware({
                route: { interaction: 'search' },
                name: 'patient',
                auth: { type: 'smart', strategy: {} }
            });
            const req = { user: { scope: 'patient/Patient.read' }, params: {} };
            const next = jestObj.fn();
            expect(() => middleware(req, {}, next)).toThrow(TypeError);
        });
    });
});
