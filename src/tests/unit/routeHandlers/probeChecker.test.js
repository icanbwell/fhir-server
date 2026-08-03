const { describe, test, expect, jest: jestObj, beforeEach, afterEach } = require('@jest/globals');

// Mock dependencies
jestObj.mock('../../../operations/common/logging', () => ({
    logInfo: jestObj.fn()
}));

jestObj.mock('../../../utils/requestCounter', () => ({
    getRequestCount: jestObj.fn()
}));

const { handleReadinessCheck, handleLivenessCheck } = require('../../../routeHandlers/probeChecker');
const { getRequestCount } = require('../../../utils/requestCounter');
const { HealthCheckError } = require('@godaddy/terminus');

describe('probeChecker route handler', () => {
    const originalEnv = process.env;

    beforeEach(() => {
        jestObj.clearAllMocks();
        process.env = { ...originalEnv };
        delete process.env.NO_OF_REQUESTS_PER_POD_REDINESS_CHECK;
        delete process.env.ENABLE_MEMORY_CHECK;
        delete process.env.CONTAINER_MEM_REQUEST;
    });

    afterEach(() => {
        process.env = originalEnv;
    });

    describe('handleReadinessCheck', () => {
        test('should not throw when NO_OF_REQUESTS_PER_POD_REDINESS_CHECK is not set', () => {
            getRequestCount.mockReturnValue(1000);

            expect(() => handleReadinessCheck()).not.toThrow();
        });

        test('should not throw when request count is below threshold', () => {
            process.env.NO_OF_REQUESTS_PER_POD_REDINESS_CHECK = '100';
            getRequestCount.mockReturnValue(50);

            expect(() => handleReadinessCheck()).not.toThrow();
        });

        test('should not throw when request count equals threshold', () => {
            process.env.NO_OF_REQUESTS_PER_POD_REDINESS_CHECK = '100';
            getRequestCount.mockReturnValue(100);

            expect(() => handleReadinessCheck()).not.toThrow();
        });

        test('should throw HealthCheckError when request count exceeds threshold', () => {
            process.env.NO_OF_REQUESTS_PER_POD_REDINESS_CHECK = '100';
            getRequestCount.mockReturnValue(101);

            expect(() => handleReadinessCheck()).toThrow(HealthCheckError);
        });

        test('should throw with message healthcheck failed when request count exceeds threshold', () => {
            process.env.NO_OF_REQUESTS_PER_POD_REDINESS_CHECK = '100';
            getRequestCount.mockReturnValue(200);

            expect(() => handleReadinessCheck()).toThrow('healthcheck failed');
        });

        test('should not throw when ENABLE_MEMORY_CHECK is not set even if memory is high', () => {
            // No memory check env var set, so memory check should not run
            expect(() => handleReadinessCheck()).not.toThrow();
        });

        test('should not throw when ENABLE_MEMORY_CHECK is set but CONTAINER_MEM_REQUEST is not set', () => {
            process.env.ENABLE_MEMORY_CHECK = 'true';

            expect(() => handleReadinessCheck()).not.toThrow();
        });

        test('should not throw when memory usage is below threshold', () => {
            process.env.ENABLE_MEMORY_CHECK = 'true';
            // Set a very high memory threshold (10GB in bytes)
            process.env.CONTAINER_MEM_REQUEST = '10737418240';

            expect(() => handleReadinessCheck()).not.toThrow();
        });

        test('should throw HealthCheckError when memory usage exceeds threshold', () => {
            process.env.ENABLE_MEMORY_CHECK = 'true';
            // Set a very low threshold (1 byte) to guarantee it will be exceeded
            process.env.CONTAINER_MEM_REQUEST = '1';

            expect(() => handleReadinessCheck()).toThrow(HealthCheckError);
        });

        test('should throw with healthcheck failed message when memory exceeds threshold', () => {
            process.env.ENABLE_MEMORY_CHECK = 'true';
            // Set a very low threshold (1 byte) to guarantee it will be exceeded
            process.env.CONTAINER_MEM_REQUEST = '1';

            expect(() => handleReadinessCheck()).toThrow('healthcheck failed');
        });

        test('should check both request count and memory and throw on request count first', () => {
            process.env.NO_OF_REQUESTS_PER_POD_REDINESS_CHECK = '10';
            process.env.ENABLE_MEMORY_CHECK = 'true';
            process.env.CONTAINER_MEM_REQUEST = '10737418240'; // high memory threshold
            getRequestCount.mockReturnValue(100); // exceeds request threshold

            expect(() => handleReadinessCheck()).toThrow(HealthCheckError);
        });

        test('should pass request count check then fail on memory check', () => {
            process.env.NO_OF_REQUESTS_PER_POD_REDINESS_CHECK = '1000';
            process.env.ENABLE_MEMORY_CHECK = 'true';
            process.env.CONTAINER_MEM_REQUEST = '1'; // very low memory threshold
            getRequestCount.mockReturnValue(5); // below request threshold

            expect(() => handleReadinessCheck()).toThrow(HealthCheckError);
        });

        test('should parse NO_OF_REQUESTS_PER_POD_REDINESS_CHECK as integer', () => {
            process.env.NO_OF_REQUESTS_PER_POD_REDINESS_CHECK = '50';
            getRequestCount.mockReturnValue(51);

            expect(() => handleReadinessCheck()).toThrow(HealthCheckError);
        });
    });

    describe('handleLivenessCheck', () => {
        let mockReq;
        let mockRes;

        beforeEach(() => {
            mockReq = {};
            mockRes = {
                sendStatus: jestObj.fn().mockReturnThis()
            };
        });

        test('should return 200 status', () => {
            handleLivenessCheck(mockReq, mockRes);

            expect(mockRes.sendStatus).toHaveBeenCalledWith(200);
        });

        test('should return the result of res.sendStatus', () => {
            const result = handleLivenessCheck(mockReq, mockRes);

            expect(result).toBe(mockRes);
        });
    });
});
