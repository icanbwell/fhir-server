'use strict';

const { describe, test, expect, beforeEach, afterEach, jest: jestObj } = require('@jest/globals');

/**
 * Creates a chainable mock request object for superagent.
 * Each method returns the same object to enable chaining like:
 * request.set(headers).auth(...).query(...).send(data).retry(n).timeout(ms)
 */
function createMockRequest (resolvedValue = { status: 200, body: { data: 'ok' } }) {
    const req = {};
    req.set = jestObj.fn(() => req);
    req.auth = jestObj.fn(() => req);
    req.query = jestObj.fn(() => req);
    req.send = jestObj.fn(() => req);
    req.retry = jestObj.fn(() => req);
    req.timeout = jestObj.fn(() => Promise.resolve(resolvedValue));
    return req;
}

// Track calls to superagent methods manually since jestObj.fn() doesn't pass
// `instanceof Function` check used in digestAuth.js source code.
const superagentCalls = { get: [], post: [], put: [], delete: [], patch: [] };
const superagentImpls = { get: null, post: null, put: null, delete: null, patch: null };

jestObj.mock('superagent', () => {
    const methods = {};
    for (const method of ['get', 'post', 'put', 'delete', 'patch']) {
        methods[`${method}`] = function (...args) {
            superagentCalls[`${method}`].push(args);
            if (superagentImpls[`${method}`]) {
                return superagentImpls[`${method}`](...args);
            }
            return createMockRequest();
        };
    }
    return methods;
});

jestObj.mock('crypto', () => ({
    randomBytes: jestObj.fn(() => ({
        toString: jestObj.fn(() => 'abcdef1234567890abcdef1234567890abcdef1234567890')
    })),
    createHash: jestObj.fn(() => ({
        update: jestObj.fn().mockReturnThis(),
        digest: jestObj.fn(() => 'fakehashdigest1234567890abcdef12')
    }))
}));

const crypto = require('crypto');
const { RequestWithDigestAuth } = require('../../../utils/digestAuth');

describe('RequestWithDigestAuth', () => {
    let originalEnv;

    beforeEach(() => {
        jestObj.clearAllMocks();
        originalEnv = process.env.EXTERNAL_REQUEST_TIMEOUT_SEC;
        delete process.env.EXTERNAL_REQUEST_TIMEOUT_SEC;
        // Reset superagent tracking
        for (const method of ['get', 'post', 'put', 'delete', 'patch']) {
            superagentCalls[`${method}`] = [];
            superagentImpls[`${method}`] = null;
        }
    });

    afterEach(() => {
        if (originalEnv !== undefined) {
            process.env.EXTERNAL_REQUEST_TIMEOUT_SEC = originalEnv;
        } else {
            delete process.env.EXTERNAL_REQUEST_TIMEOUT_SEC;
        }
    });

    describe('constructor', () => {
        test('throws when username is not provided', () => {
            expect(() => new RequestWithDigestAuth({ password: 'pass', username: '' }))
                .toThrow('Username and password are required');
        });

        test('throws when password is not provided', () => {
            expect(() => new RequestWithDigestAuth({ username: 'user', password: '' }))
                .toThrow('Username and password are required');
        });

        test('throws when both username and password are missing', () => {
            expect(() => new RequestWithDigestAuth({}))
                .toThrow('Username and password are required');
        });

        test('throws when username is null', () => {
            expect(() => new RequestWithDigestAuth({ username: null, password: 'pass' }))
                .toThrow('Username and password are required');
        });

        test('throws when password is undefined', () => {
            expect(() => new RequestWithDigestAuth({ username: 'user', password: undefined }))
                .toThrow('Username and password are required');
        });

        test('sets default retry to 1 when not provided', () => {
            const auth = new RequestWithDigestAuth({ username: 'user', password: 'pass' });
            expect(auth.retry).toBe(1);
        });

        test('accepts custom retry value', () => {
            const auth = new RequestWithDigestAuth({ username: 'user', password: 'pass', retry: 3 });
            expect(auth.retry).toBe(3);
        });

        test('sets retry to 1 when retry is explicitly undefined', () => {
            const auth = new RequestWithDigestAuth({ username: 'user', password: 'pass', retry: undefined });
            expect(auth.retry).toBe(1);
        });

        test('stores username and password', () => {
            const auth = new RequestWithDigestAuth({ username: 'myuser', password: 'mypass' });
            expect(auth.username).toBe('myuser');
            expect(auth.password).toBe('mypass');
        });

        test('initializes count to 0', () => {
            const auth = new RequestWithDigestAuth({ username: 'user', password: 'pass' });
            expect(auth.count).toBe(0);
        });
    });

    describe('requestTimeout', () => {
        test('defaults to 30000ms (30 seconds) when env var not set', () => {
            const auth = new RequestWithDigestAuth({ username: 'user', password: 'pass' });
            expect(auth.requestTimeout).toBe(30000);
        });

        test('uses EXTERNAL_REQUEST_TIMEOUT_SEC env var when set', () => {
            process.env.EXTERNAL_REQUEST_TIMEOUT_SEC = '60';
            const auth = new RequestWithDigestAuth({ username: 'user', password: 'pass' });
            expect(auth.requestTimeout).toBe(60000);
        });

        test('multiplies env var value by 1000 to convert to milliseconds', () => {
            process.env.EXTERNAL_REQUEST_TIMEOUT_SEC = '15';
            const auth = new RequestWithDigestAuth({ username: 'user', password: 'pass' });
            expect(auth.requestTimeout).toBe(15000);
        });

        test('falls back to 30s when env var is not a number', () => {
            process.env.EXTERNAL_REQUEST_TIMEOUT_SEC = 'invalid';
            const auth = new RequestWithDigestAuth({ username: 'user', password: 'pass' });
            expect(auth.requestTimeout).toBe(30000);
        });

        test('falls back to 30s when env var is empty string', () => {
            process.env.EXTERNAL_REQUEST_TIMEOUT_SEC = '';
            const auth = new RequestWithDigestAuth({ username: 'user', password: 'pass' });
            expect(auth.requestTimeout).toBe(30000);
        });
    });

    describe('request()', () => {
        let auth;

        beforeEach(() => {
            auth = new RequestWithDigestAuth({ username: 'user', password: 'pass' });
        });

        test('passes through on successful 200 response', async () => {
            const expectedResponse = { status: 200, body: { resourceType: 'Patient' } };
            superagentImpls.get = () => createMockRequest(expectedResponse);

            const result = await auth.request({ method: 'get', url: 'http://example.com/api' });
            expect(result).toEqual(expectedResponse);
        });

        test('retries with digest auth on 401 with www-authenticate nonce header', async () => {
            const error401 = new Error('Unauthorized');
            error401.response = {
                status: 401,
                headers: {
                    'www-authenticate': 'Digest realm="test",nonce="abc123",qop="auth"'
                }
            };
            const successResponse = { status: 200, body: { data: 'authenticated' } };

            let callCount = 0;
            superagentImpls.get = () => {
                const req = createMockRequest();
                req.timeout = jestObj.fn(() => {
                    callCount++;
                    if (callCount === 1) {
                        return Promise.reject(error401);
                    }
                    return Promise.resolve(successResponse);
                });
                return req;
            };

            const result = await auth.request({ method: 'get', url: 'http://example.com/api' });
            expect(result).toEqual(successResponse);
            expect(crypto.createHash).toHaveBeenCalled();
        });

        test('does NOT retry on 401 without www-authenticate header', async () => {
            const error401 = new Error('Unauthorized');
            error401.response = {
                status: 401,
                headers: {}
            };

            superagentImpls.get = () => {
                const req = createMockRequest();
                req.timeout = jestObj.fn(() => Promise.reject(error401));
                return req;
            };

            await expect(auth.request({ method: 'get', url: 'http://example.com/api' }))
                .rejects.toThrow('Unauthorized');
        });

        test('does NOT retry on 401 when www-authenticate lacks nonce', async () => {
            const error401 = new Error('Unauthorized');
            error401.response = {
                status: 401,
                headers: {
                    'www-authenticate': 'Basic realm="test"'
                }
            };

            superagentImpls.get = () => {
                const req = createMockRequest();
                req.timeout = jestObj.fn(() => Promise.reject(error401));
                return req;
            };

            await expect(auth.request({ method: 'get', url: 'http://example.com/api' }))
                .rejects.toThrow('Unauthorized');
        });

        test('does NOT retry more than this.retry times', async () => {
            auth.retry = 1;

            const error401 = new Error('Unauthorized');
            error401.response = {
                status: 401,
                headers: {
                    'www-authenticate': 'Digest realm="test",nonce="abc123",qop="auth"'
                }
            };

            superagentImpls.get = () => {
                const req = createMockRequest();
                req.timeout = jestObj.fn(() => Promise.reject(error401));
                return req;
            };

            await expect(auth.request({ method: 'get', url: 'http://example.com/api' }))
                .rejects.toThrow('Unauthorized');
        });

        test('throws non-401 errors immediately without retry', async () => {
            const error500 = new Error('Internal Server Error');
            error500.response = { status: 500, headers: {} };

            superagentImpls.get = () => {
                const req = createMockRequest();
                req.timeout = jestObj.fn(() => Promise.reject(error500));
                return req;
            };

            await expect(auth.request({ method: 'get', url: 'http://example.com/api' }))
                .rejects.toThrow('Internal Server Error');
        });

        test('throws errors with undefined response', async () => {
            const networkError = new Error('Network Error');

            superagentImpls.get = () => {
                const req = createMockRequest();
                req.timeout = jestObj.fn(() => Promise.reject(networkError));
                return req;
            };

            await expect(auth.request({ method: 'get', url: 'http://example.com/api' }))
                .rejects.toThrow('Network Error');
        });

        test('increments count on digest retry', async () => {
            const error401 = new Error('Unauthorized');
            error401.response = {
                status: 401,
                headers: {
                    'www-authenticate': 'Digest realm="test",nonce="abc123",qop="auth"'
                }
            };
            const successResponse = { status: 200, body: {} };

            let callCount = 0;
            superagentImpls.get = () => {
                const req = createMockRequest();
                req.timeout = jestObj.fn(() => {
                    callCount++;
                    if (callCount === 1) {
                        return Promise.reject(error401);
                    }
                    return Promise.resolve(successResponse);
                });
                return req;
            };

            expect(auth.count).toBe(0);
            await auth.request({ method: 'get', url: 'http://example.com/api' });
            expect(auth.count).toBe(1);
        });

        test('uses method from options for digest hash computation', async () => {
            const error401 = new Error('Unauthorized');
            error401.response = {
                status: 401,
                headers: {
                    'www-authenticate': 'Digest realm="test",nonce="abc123",qop="auth"'
                }
            };
            const successResponse = { status: 200, body: {} };

            let callCount = 0;
            superagentImpls.post = () => {
                const req = createMockRequest();
                req.timeout = jestObj.fn(() => {
                    callCount++;
                    if (callCount === 1) {
                        return Promise.reject(error401);
                    }
                    return Promise.resolve(successResponse);
                });
                return req;
            };

            await auth.request({ method: 'post', url: 'http://example.com/api/Patient' });
            expect(crypto.createHash).toHaveBeenCalledWith('md5');
        });

        test('returns undefined when method is not specified (no superagent method matches)', async () => {
            // When method is undefined, superagent[undefined] is not a Function,
            // so _sendRequest returns undefined without making a request
            const result = await auth.request({ url: 'http://example.com/api' });
            expect(result).toBeUndefined();
            expect(superagentCalls.get).toHaveLength(0);
        });
    });

    describe('_sendRequest()', () => {
        let auth;

        beforeEach(() => {
            auth = new RequestWithDigestAuth({ username: 'user', password: 'pass' });
        });

        test('calls superagent with correct method and url', async () => {
            await auth._sendRequest({ method: 'post', url: 'http://example.com/data' });
            expect(superagentCalls.post).toHaveLength(1);
            expect(superagentCalls.post[0]).toEqual(['http://example.com/data']);
        });

        test('sets headers when provided', async () => {
            let capturedReq;
            superagentImpls.get = () => {
                capturedReq = createMockRequest();
                return capturedReq;
            };

            const headers = { 'Content-Type': 'application/json', Authorization: 'Bearer token' };
            await auth._sendRequest({ method: 'get', url: 'http://example.com', headers });
            expect(capturedReq.set).toHaveBeenCalledWith(headers);
        });

        test('does not call set when headers not provided', async () => {
            let capturedReq;
            superagentImpls.get = () => {
                capturedReq = createMockRequest();
                return capturedReq;
            };

            await auth._sendRequest({ method: 'get', url: 'http://example.com' });
            expect(capturedReq.set).not.toHaveBeenCalled();
        });

        test('calls auth when auth options provided', async () => {
            let capturedReq;
            superagentImpls.get = () => {
                capturedReq = createMockRequest();
                return capturedReq;
            };

            const authOpts = { user: 'admin', pass: 'secret', options: { type: 'basic' } };
            await auth._sendRequest({ method: 'get', url: 'http://example.com', auth: authOpts });
            expect(capturedReq.auth).toHaveBeenCalledWith('admin', 'secret', { type: 'basic' });
        });

        test('does not call auth when auth not provided', async () => {
            let capturedReq;
            superagentImpls.get = () => {
                capturedReq = createMockRequest();
                return capturedReq;
            };

            await auth._sendRequest({ method: 'get', url: 'http://example.com' });
            expect(capturedReq.auth).not.toHaveBeenCalled();
        });

        test('calls query when query params provided', async () => {
            let capturedReq;
            superagentImpls.get = () => {
                capturedReq = createMockRequest();
                return capturedReq;
            };

            const query = { _count: 10, _offset: 0 };
            await auth._sendRequest({ method: 'get', url: 'http://example.com', query });
            expect(capturedReq.query).toHaveBeenCalledWith(query);
        });

        test('does not call query when query not provided', async () => {
            let capturedReq;
            superagentImpls.get = () => {
                capturedReq = createMockRequest();
                return capturedReq;
            };

            await auth._sendRequest({ method: 'get', url: 'http://example.com' });
            expect(capturedReq.query).not.toHaveBeenCalled();
        });

        test('sends data payload', async () => {
            let capturedReq;
            superagentImpls.post = () => {
                capturedReq = createMockRequest();
                return capturedReq;
            };

            const data = { resourceType: 'Patient', name: [{ family: 'Smith' }] };
            await auth._sendRequest({ method: 'post', url: 'http://example.com', data });
            expect(capturedReq.send).toHaveBeenCalledWith(data);
        });

        test('applies retry and timeout to request', async () => {
            let capturedReq;
            superagentImpls.get = () => {
                capturedReq = createMockRequest();
                return capturedReq;
            };

            await auth._sendRequest({ method: 'get', url: 'http://example.com' });
            expect(capturedReq.retry).toHaveBeenCalledWith(3); // EXTERNAL_REQUEST_RETRY_COUNT
            expect(capturedReq.timeout).toHaveBeenCalledWith(30000);
        });

        test('returns undefined for invalid method', async () => {
            const result = await auth._sendRequest({ method: 'invalid', url: 'http://example.com' });
            expect(result).toBeUndefined();
        });
    });
});
