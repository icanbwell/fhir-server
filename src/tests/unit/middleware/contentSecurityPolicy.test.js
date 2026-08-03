'use strict';

const { describe, test, expect, jest: jestObj, beforeEach, afterEach } = require('@jest/globals');

jestObj.mock('express-http-context', () => ({
    get: jestObj.fn(() => 'test-nonce-123')
}));

const { handleSecurityPolicy, handleSecurityPolicyGraphql } = require('../../../routeHandlers/contentSecurityPolicy');

describe('contentSecurityPolicy', () => {
    let originalAuthUrl;

    beforeEach(() => {
        originalAuthUrl = process.env.AUTH_CODE_FLOW_URL;
        process.env.AUTH_CODE_FLOW_URL = 'https://auth.example.com';
    });

    afterEach(() => {
        if (originalAuthUrl !== undefined) {
            process.env.AUTH_CODE_FLOW_URL = originalAuthUrl;
        } else {
            delete process.env.AUTH_CODE_FLOW_URL;
        }
    });

    const makeRes = () => ({
        headersSent: false,
        setHeader: jestObj.fn()
    });

    describe('handleSecurityPolicy', () => {
        test('sets Content-Security-Policy header', () => {
            const res = makeRes();
            const next = jestObj.fn();
            handleSecurityPolicy({}, res, next);
            expect(res.setHeader).toHaveBeenCalledWith(
                'Content-Security-Policy',
                expect.stringContaining("default-src 'self'")
            );
        });

        test('includes nonce in script-src', () => {
            const res = makeRes();
            handleSecurityPolicy({}, res, jestObj.fn());
            const csp = res.setHeader.mock.calls[0][1];
            expect(csp).toContain("'nonce-test-nonce-123'");
        });

        test('includes AUTH_CODE_FLOW_URL in policy', () => {
            const res = makeRes();
            handleSecurityPolicy({}, res, jestObj.fn());
            const csp = res.setHeader.mock.calls[0][1];
            expect(csp).toContain('https://auth.example.com');
        });

        test('does not set header when headersSent is true', () => {
            const res = { headersSent: true, setHeader: jestObj.fn() };
            handleSecurityPolicy({}, res, jestObj.fn());
            expect(res.setHeader).not.toHaveBeenCalled();
        });

        test('always calls next()', () => {
            const next = jestObj.fn();
            handleSecurityPolicy({}, makeRes(), next);
            expect(next).toHaveBeenCalled();
        });
    });

    describe('handleSecurityPolicyGraphql', () => {
        test('sets Content-Security-Policy header for GraphQL', () => {
            const res = makeRes();
            handleSecurityPolicyGraphql({}, res, jestObj.fn());
            expect(res.setHeader).toHaveBeenCalledWith(
                'Content-Security-Policy',
                expect.stringContaining("default-src 'self'")
            );
        });

        test('uses unsafe-inline instead of nonce for GraphQL', () => {
            const res = makeRes();
            handleSecurityPolicyGraphql({}, res, jestObj.fn());
            const csp = res.setHeader.mock.calls[0][1];
            expect(csp).toContain("'unsafe-inline'");
            expect(csp).not.toContain('nonce-');
        });

        test('does not set header when headersSent is true', () => {
            const res = { headersSent: true, setHeader: jestObj.fn() };
            handleSecurityPolicyGraphql({}, res, jestObj.fn());
            expect(res.setHeader).not.toHaveBeenCalled();
        });

        test('always calls next()', () => {
            const next = jestObj.fn();
            handleSecurityPolicyGraphql({}, makeRes(), next);
            expect(next).toHaveBeenCalled();
        });
    });
});
