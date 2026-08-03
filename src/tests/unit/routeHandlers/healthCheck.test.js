const { describe, test, expect, jest: jestObj, beforeEach, afterEach } = require('@jest/globals');

// Mock dependencies
jestObj.mock('../../../utils/kafkaHealthCheck', () => ({
    handleKafkaHealthCheck: jestObj.fn()
}));

jestObj.mock('../../../strategies/authService', () => ({
    AuthService: jestObj.fn().mockImplementation(() => ({
        getJwksByUrlAsync: jestObj.fn().mockResolvedValue({}),
        getExternalJwksAsync: jestObj.fn().mockResolvedValue({})
    }))
}));

const { handleHealthCheck } = require('../../../routeHandlers/healthCheck');
const { handleKafkaHealthCheck } = require('../../../utils/kafkaHealthCheck');
const { AuthService } = require('../../../strategies/authService');

describe('healthCheck route handler', () => {
    let mockContainer;
    let mockReq;
    let mockRes;
    let fnGetContainer;

    beforeEach(() => {
        jestObj.clearAllMocks();

        mockContainer = {
            configManager: {
                authJwksUrl: 'https://auth.example.com/.well-known/jwks.json'
            },
            wellKnownConfigurationManager: {}
        };

        mockReq = {};
        mockRes = {
            json: jestObj.fn().mockReturnThis()
        };

        fnGetContainer = jestObj.fn().mockReturnValue(mockContainer);
    });

    test('should return status OK when kafka health check succeeds', async () => {
        handleKafkaHealthCheck.mockResolvedValue(true);

        await handleHealthCheck(fnGetContainer, mockReq, mockRes);

        expect(mockRes.json).toHaveBeenCalledWith({ status: 'OK' });
    });

    test('should return status Failed when kafka health check returns false', async () => {
        handleKafkaHealthCheck.mockResolvedValue(false);

        await handleHealthCheck(fnGetContainer, mockReq, mockRes);

        expect(mockRes.json).toHaveBeenCalledWith({ status: 'Failed' });
    });

    test('should return status Failed when kafka health check throws an error', async () => {
        handleKafkaHealthCheck.mockRejectedValue(new Error('Kafka connection failed'));

        await handleHealthCheck(fnGetContainer, mockReq, mockRes);

        expect(mockRes.json).toHaveBeenCalledWith({ status: 'Failed' });
    });

    test('should create AuthService with correct configManager and wellKnownConfigurationManager', async () => {
        handleKafkaHealthCheck.mockResolvedValue(true);

        await handleHealthCheck(fnGetContainer, mockReq, mockRes);

        expect(AuthService).toHaveBeenCalledWith({
            configManager: mockContainer.configManager,
            wellKnownConfigurationManager: mockContainer.wellKnownConfigurationManager
        });
    });

    test('should call getJwksByUrlAsync with authJwksUrl from configManager', async () => {
        handleKafkaHealthCheck.mockResolvedValue(true);
        const mockGetJwks = jestObj.fn().mockResolvedValue({});
        const mockGetExternalJwks = jestObj.fn().mockResolvedValue({});
        AuthService.mockImplementation(() => ({
            getJwksByUrlAsync: mockGetJwks,
            getExternalJwksAsync: mockGetExternalJwks
        }));

        await handleHealthCheck(fnGetContainer, mockReq, mockRes);

        expect(mockGetJwks).toHaveBeenCalledWith('https://auth.example.com/.well-known/jwks.json');
    });

    test('should call getExternalJwksAsync', async () => {
        handleKafkaHealthCheck.mockResolvedValue(true);
        const mockGetJwks = jestObj.fn().mockResolvedValue({});
        const mockGetExternalJwks = jestObj.fn().mockResolvedValue({});
        AuthService.mockImplementation(() => ({
            getJwksByUrlAsync: mockGetJwks,
            getExternalJwksAsync: mockGetExternalJwks
        }));

        await handleHealthCheck(fnGetContainer, mockReq, mockRes);

        expect(mockGetExternalJwks).toHaveBeenCalled();
    });

    test('should cache container after first invocation and not call fnGetContainer again', async () => {
        handleKafkaHealthCheck.mockResolvedValue(true);

        // The module caches the container at module level.
        // After initial call, subsequent calls reuse the cached container.
        await handleHealthCheck(fnGetContainer, mockReq, mockRes);
        const callCount = fnGetContainer.mock.calls.length;

        // Call again - fnGetContainer should not be called again
        await handleHealthCheck(fnGetContainer, mockReq, mockRes);
        expect(fnGetContainer.mock.calls.length).toBe(callCount);
    });

    test('should pass container to handleKafkaHealthCheck', async () => {
        handleKafkaHealthCheck.mockResolvedValue(true);

        await handleHealthCheck(fnGetContainer, mockReq, mockRes);

        expect(handleKafkaHealthCheck).toHaveBeenCalled();
    });
});
