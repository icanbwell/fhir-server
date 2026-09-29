const { describe, test, expect, jest: jestObj, beforeEach, afterEach } = require('@jest/globals');

// Mock superagent
const mockTimeout = jestObj.fn();
const mockRetry = jestObj.fn().mockReturnValue({ timeout: mockTimeout });
const mockSet = jestObj.fn().mockReturnValue({ retry: mockRetry });
const mockGet = jestObj.fn().mockReturnValue({ set: mockSet });

jestObj.mock('superagent', () => ({
    get: mockGet
}));

jestObj.mock('../../../utils/httpErrors', () => ({
    ExternalTimeoutError: class ExternalTimeoutError extends Error {
        constructor(message) {
            super(message);
            this.name = 'ExternalTimeoutError';
        }
    }
}));

jestObj.mock('../../../constants', () => ({
    EXTERNAL_REQUEST_RETRY_COUNT: 3,
    DEFAULT_CACHE_EXPIRY_TIME: 24 * 60 * 60 * 1000
}));

describe('smartConfiguration route handler', () => {
    const originalEnv = process.env;
    let mockReq;
    let mockRes;
    let mockNext;
    let handleSmartConfiguration;

    beforeEach(() => {
        jestObj.clearAllMocks();
        process.env = { ...originalEnv };
        delete process.env.AUTH_CONFIGURATION_URI;
        delete process.env.EXTERNAL_REQUEST_TIMEOUT_SEC;
        delete process.env.CACHE_EXPIRY_TIME;

        mockReq = {};
        mockRes = {
            json: jestObj.fn().mockReturnThis()
        };
        mockNext = jestObj.fn();

        // Re-require to reset module-level state (cached response, lastRequestTime)
        jestObj.resetModules();

        // Re-mock after resetModules
        jestObj.mock('superagent', () => ({
            get: mockGet
        }));
        jestObj.mock('../../../utils/httpErrors', () => ({
            ExternalTimeoutError: class ExternalTimeoutError extends Error {
                constructor(message) {
                    super(message);
                    this.name = 'ExternalTimeoutError';
                }
            }
        }));
        jestObj.mock('../../../constants', () => ({
            EXTERNAL_REQUEST_RETRY_COUNT: 3,
            DEFAULT_CACHE_EXPIRY_TIME: 24 * 60 * 60 * 1000
        }));

        handleSmartConfiguration = require('../../../routeHandlers/smartConfiguration').handleSmartConfiguration;
    });

    afterEach(() => {
        process.env = originalEnv;
    });

    test('should return empty json when AUTH_CONFIGURATION_URI is not set', async () => {
        await handleSmartConfiguration(mockReq, mockRes, mockNext);

        expect(mockRes.json).toHaveBeenCalledWith();
    });

    test('should fetch configuration from AUTH_CONFIGURATION_URI when set', async () => {
        process.env.AUTH_CONFIGURATION_URI = 'https://auth.example.com/.well-known/smart-configuration';
        const responseBody = JSON.stringify({
            authorization_endpoint: 'https://auth.example.com/authorize',
            token_endpoint: 'https://auth.example.com/token'
        });
        mockTimeout.mockResolvedValue({ text: responseBody });

        await handleSmartConfiguration(mockReq, mockRes, mockNext);

        expect(mockGet).toHaveBeenCalledWith('https://auth.example.com/.well-known/smart-configuration');
        expect(mockSet).toHaveBeenCalledWith({ Accept: 'application/json' });
        expect(mockRetry).toHaveBeenCalledWith(3);
    });

    test('should return parsed JSON response from configuration endpoint', async () => {
        process.env.AUTH_CONFIGURATION_URI = 'https://auth.example.com/.well-known/smart-configuration';
        const configData = {
            authorization_endpoint: 'https://auth.example.com/authorize',
            token_endpoint: 'https://auth.example.com/token',
            capabilities: ['launch-ehr', 'client-public']
        };
        mockTimeout.mockResolvedValue({ text: JSON.stringify(configData) });

        await handleSmartConfiguration(mockReq, mockRes, mockNext);

        expect(mockRes.json).toHaveBeenCalledWith(configData);
    });

    test('should call next with ExternalTimeoutError when request times out', async () => {
        process.env.AUTH_CONFIGURATION_URI = 'https://auth.example.com/.well-known/smart-configuration';
        const timeoutError = new Error('Timeout');
        timeoutError.timeout = 30000;
        mockTimeout.mockRejectedValue(timeoutError);

        await handleSmartConfiguration(mockReq, mockRes, mockNext);

        expect(mockNext).toHaveBeenCalled();
        const errorArg = mockNext.mock.calls[0][0];
        expect(errorArg.name).toBe('ExternalTimeoutError');
        expect(errorArg.message).toContain('Request timeout for 30000 ms');
    });

    test('should call next with the error for non-timeout errors', async () => {
        process.env.AUTH_CONFIGURATION_URI = 'https://auth.example.com/.well-known/smart-configuration';
        const networkError = new Error('Network failure');
        mockTimeout.mockRejectedValue(networkError);

        await handleSmartConfiguration(mockReq, mockRes, mockNext);

        expect(mockNext).toHaveBeenCalledWith(networkError);
    });

    test('should use cached response on subsequent calls within cache period', async () => {
        process.env.AUTH_CONFIGURATION_URI = 'https://auth.example.com/.well-known/smart-configuration';
        const configData = {
            authorization_endpoint: 'https://auth.example.com/authorize'
        };
        mockTimeout.mockResolvedValue({ text: JSON.stringify(configData) });

        // First call - fetches from endpoint
        await handleSmartConfiguration(mockReq, mockRes, mockNext);
        expect(mockGet).toHaveBeenCalledTimes(1);

        // Second call - should use cache
        mockRes.json.mockClear();
        await handleSmartConfiguration(mockReq, mockRes, mockNext);

        expect(mockGet).toHaveBeenCalledTimes(1); // Not called again
        expect(mockRes.json).toHaveBeenCalledWith(configData);
    });

    test('should not use cache when AUTH_CONFIGURATION_URI is not set', async () => {
        // Without AUTH_CONFIGURATION_URI, should just return empty json
        await handleSmartConfiguration(mockReq, mockRes, mockNext);

        expect(mockRes.json).toHaveBeenCalledWith();
        expect(mockGet).not.toHaveBeenCalled();
    });
});
