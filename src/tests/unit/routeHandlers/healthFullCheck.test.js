const { describe, test, expect, jest: jestObj, beforeEach } = require('@jest/globals');

// Mock dependencies
jestObj.mock('../../../utils/kafkaHealthCheck', () => ({
    handleKafkaHealthCheck: jestObj.fn()
}));

jestObj.mock('../../../utils/logHealthCheck', () => ({
    handleLogHealthCheck: jestObj.fn()
}));

jestObj.mock('../../../utils/mongoDBHealthCheck', () => ({
    handleHealthCheckQuery: jestObj.fn()
}));

jestObj.mock('../../../utils/isTrue', () => ({
    isTrue: jestObj.fn()
}));

const { handleKafkaHealthCheck } = require('../../../utils/kafkaHealthCheck');
const { handleLogHealthCheck } = require('../../../utils/logHealthCheck');
const { handleHealthCheckQuery } = require('../../../utils/mongoDBHealthCheck');
const { isTrue } = require('../../../utils/isTrue');

describe('healthFullCheck route handler', () => {
    let mockContainer;
    let mockReq;
    let mockRes;
    let fnGetContainer;
    let handleFullHealthCheck;

    beforeEach(() => {
        jestObj.clearAllMocks();
        // Reset the module to clear the cached container
        jestObj.resetModules();
        // Re-mock after resetModules
        jestObj.mock('../../../utils/kafkaHealthCheck', () => ({
            handleKafkaHealthCheck: jestObj.fn()
        }));
        jestObj.mock('../../../utils/logHealthCheck', () => ({
            handleLogHealthCheck: jestObj.fn()
        }));
        jestObj.mock('../../../utils/mongoDBHealthCheck', () => ({
            handleHealthCheckQuery: jestObj.fn()
        }));
        jestObj.mock('../../../utils/isTrue', () => ({
            isTrue: jestObj.fn()
        }));

        // Re-require after reset
        const healthModule = require('../../../routeHandlers/healthFullCheck');
        handleFullHealthCheck = healthModule.handleFullHealthCheck;
        const kafkaMock = require('../../../utils/kafkaHealthCheck');
        const logMock = require('../../../utils/logHealthCheck');
        const mongoMock = require('../../../utils/mongoDBHealthCheck');
        const isTrueMock = require('../../../utils/isTrue');

        mockContainer = {
            redisClient: {
                checkConnectionHealth: jestObj.fn()
            }
        };

        mockReq = {};
        mockRes = {
            json: jestObj.fn().mockReturnThis()
        };

        fnGetContainer = jestObj.fn().mockReturnValue(mockContainer);

        // Store references for access in tests
        handleFullHealthCheck._kafkaMock = kafkaMock.handleKafkaHealthCheck;
        handleFullHealthCheck._logMock = logMock.handleLogHealthCheck;
        handleFullHealthCheck._mongoMock = mongoMock.handleHealthCheckQuery;
        handleFullHealthCheck._isTrueMock = isTrueMock.isTrue;
    });

    test('returns OK for all services when all checks resolve successfully', async () => {
        // Promise.allSettled returns settled result objects which are always truthy
        // so the code treats any resolved promise (even with false value) as OK
        handleFullHealthCheck._kafkaMock.mockResolvedValue(true);
        handleFullHealthCheck._logMock.mockResolvedValue(true);
        handleFullHealthCheck._mongoMock.mockResolvedValue(true);
        mockContainer.redisClient.checkConnectionHealth.mockResolvedValue(true);
        handleFullHealthCheck._isTrueMock.mockReturnValue(true);

        await handleFullHealthCheck(fnGetContainer, mockReq, mockRes);

        expect(mockRes.json).toHaveBeenCalledWith({
            status: {
                kafkaStatus: 'OK',
                logStatus: 'OK',
                mongoDBStatus: 'OK',
                redisStatus: 'OK'
            }
        });
    });

    test('returns Disabled status for redis when ENABLE_REDIS is not true but redis resolves', async () => {
        handleFullHealthCheck._kafkaMock.mockResolvedValue(true);
        handleFullHealthCheck._logMock.mockResolvedValue(true);
        handleFullHealthCheck._mongoMock.mockResolvedValue(true);
        mockContainer.redisClient.checkConnectionHealth.mockResolvedValue(true);
        handleFullHealthCheck._isTrueMock.mockReturnValue(false);

        await handleFullHealthCheck(fnGetContainer, mockReq, mockRes);

        const result = mockRes.json.mock.calls[0][0];
        expect(result.status.redisStatus).toBe('Disabled');
    });

    test('returns all Failed when an exception is thrown in the try block', async () => {
        // If the function called on container throws synchronously or before allSettled
        mockContainer.redisClient.checkConnectionHealth = undefined;

        // Make the container throw when accessing redisClient
        const throwingContainer = new Proxy({}, {
            get() {
                throw new Error('container error');
            }
        });
        const throwingGetContainer = jestObj.fn().mockReturnValue(throwingContainer);

        await handleFullHealthCheck(throwingGetContainer, mockReq, mockRes);

        const result = mockRes.json.mock.calls[0][0];
        expect(result.status.kafkaStatus).toBe('Failed');
        expect(result.status.logStatus).toBe('Failed');
        expect(result.status.mongoDBStatus).toBe('Failed');
        expect(result.status.redisStatus).toBe('Failed');
    });

    test('calls fnGetContainer to get the container', async () => {
        handleFullHealthCheck._kafkaMock.mockResolvedValue(true);
        handleFullHealthCheck._logMock.mockResolvedValue(true);
        handleFullHealthCheck._mongoMock.mockResolvedValue(true);
        mockContainer.redisClient.checkConnectionHealth.mockResolvedValue(true);
        handleFullHealthCheck._isTrueMock.mockReturnValue(true);

        await handleFullHealthCheck(fnGetContainer, mockReq, mockRes);

        expect(fnGetContainer).toHaveBeenCalled();
    });

    test('passes container to kafka health check', async () => {
        handleFullHealthCheck._kafkaMock.mockResolvedValue(true);
        handleFullHealthCheck._logMock.mockResolvedValue(true);
        handleFullHealthCheck._mongoMock.mockResolvedValue(true);
        mockContainer.redisClient.checkConnectionHealth.mockResolvedValue(true);
        handleFullHealthCheck._isTrueMock.mockReturnValue(true);

        await handleFullHealthCheck(fnGetContainer, mockReq, mockRes);

        expect(handleFullHealthCheck._kafkaMock).toHaveBeenCalledWith(mockContainer);
    });

    test('passes container to mongoDB health check', async () => {
        handleFullHealthCheck._kafkaMock.mockResolvedValue(true);
        handleFullHealthCheck._logMock.mockResolvedValue(true);
        handleFullHealthCheck._mongoMock.mockResolvedValue(true);
        mockContainer.redisClient.checkConnectionHealth.mockResolvedValue(true);
        handleFullHealthCheck._isTrueMock.mockReturnValue(true);

        await handleFullHealthCheck(fnGetContainer, mockReq, mockRes);

        expect(handleFullHealthCheck._mongoMock).toHaveBeenCalledWith(mockContainer);
    });

    test('calls handleLogHealthCheck with no arguments', async () => {
        handleFullHealthCheck._kafkaMock.mockResolvedValue(true);
        handleFullHealthCheck._logMock.mockResolvedValue(true);
        handleFullHealthCheck._mongoMock.mockResolvedValue(true);
        mockContainer.redisClient.checkConnectionHealth.mockResolvedValue(true);
        handleFullHealthCheck._isTrueMock.mockReturnValue(true);

        await handleFullHealthCheck(fnGetContainer, mockReq, mockRes);

        expect(handleFullHealthCheck._logMock).toHaveBeenCalledWith();
    });

    test('returns json response with status object', async () => {
        handleFullHealthCheck._kafkaMock.mockResolvedValue(true);
        handleFullHealthCheck._logMock.mockResolvedValue(true);
        handleFullHealthCheck._mongoMock.mockResolvedValue(true);
        mockContainer.redisClient.checkConnectionHealth.mockResolvedValue(true);
        handleFullHealthCheck._isTrueMock.mockReturnValue(true);

        await handleFullHealthCheck(fnGetContainer, mockReq, mockRes);

        expect(mockRes.json).toHaveBeenCalledTimes(1);
        const result = mockRes.json.mock.calls[0][0];
        expect(result).toHaveProperty('status');
        expect(result.status).toHaveProperty('kafkaStatus');
        expect(result.status).toHaveProperty('logStatus');
        expect(result.status).toHaveProperty('mongoDBStatus');
        expect(result.status).toHaveProperty('redisStatus');
    });

    test('caches container from fnGetContainer on first call', async () => {
        handleFullHealthCheck._kafkaMock.mockResolvedValue(true);
        handleFullHealthCheck._logMock.mockResolvedValue(true);
        handleFullHealthCheck._mongoMock.mockResolvedValue(true);
        mockContainer.redisClient.checkConnectionHealth.mockResolvedValue(true);
        handleFullHealthCheck._isTrueMock.mockReturnValue(true);

        // Call twice
        await handleFullHealthCheck(fnGetContainer, mockReq, mockRes);
        await handleFullHealthCheck(fnGetContainer, mockReq, mockRes);

        // fnGetContainer should only be called once due to caching
        expect(fnGetContainer).toHaveBeenCalledTimes(1);
    });
});
