const { describe, test, expect, jest, beforeEach } = require('@jest/globals');

const mockRequest = {
    send: jest.fn(),
    set: jest.fn(),
    retry: jest.fn(),
    timeout: jest.fn()
};

const mockPost = jest.fn();

jest.mock('superagent', () => ({
    post: mockPost
}));

const { PersonMatchManager } = require('../../admin/personMatchManager');
const { DatabaseQueryFactory } = require('../../dataLayer/databaseQueryFactory');
const { ConfigManager } = require('../../utils/configManager');
const { OAuthClientCredentialsHelper } = require('../../utils/oauthClientCredentialsHelper');
const { AuditLogger } = require('../../utils/auditLogger');
const { PostRequestProcessor } = require('../../utils/postRequestProcessor');
const { RequestSpecificCache } = require('../../utils/requestSpecificCache');

describe('PersonMatchManager', () => {
    let personMatchManager;
    let mockConfigManager;
    let mockOauthHelper;
    let mockAuditLogger;
    let mockPostRequestProcessor;
    let mockRequestSpecificCache;
    let mockDatabaseQueryFactory;

    beforeEach(() => {
        jest.clearAllMocks();

        // Re-wire the superagent mock chain
        mockRequest.send.mockReturnValue(mockRequest);
        mockRequest.set.mockReturnValue(mockRequest);
        mockRequest.retry.mockReturnValue(mockRequest);
        mockRequest.timeout.mockResolvedValue({
            body: { resourceType: 'Bundle', entry: [] }
        });
        mockPost.mockReturnValue(mockRequest);

        mockDatabaseQueryFactory = Object.create(DatabaseQueryFactory.prototype);
        mockConfigManager = Object.create(ConfigManager.prototype);
        Object.defineProperty(mockConfigManager, 'personMatchingServiceUrl', {
            get: () => 'https://match.example.com/$match'
        });
        Object.defineProperty(mockConfigManager, 'requestTimeoutMs', {
            get: () => 30000
        });

        mockOauthHelper = Object.create(OAuthClientCredentialsHelper.prototype);
        mockOauthHelper.getAccessTokenAsync = jest.fn().mockResolvedValue('mock-token');

        mockAuditLogger = Object.create(AuditLogger.prototype);
        mockAuditLogger.logAuditEntryAsync = jest.fn().mockResolvedValue(undefined);

        mockPostRequestProcessor = Object.create(PostRequestProcessor.prototype);
        mockPostRequestProcessor.add = jest.fn();
        mockPostRequestProcessor.executeAsync = jest.fn().mockResolvedValue(undefined);

        mockRequestSpecificCache = Object.create(RequestSpecificCache.prototype);
        mockRequestSpecificCache.clearAsync = jest.fn().mockResolvedValue(undefined);

        personMatchManager = new PersonMatchManager({
            databaseQueryFactory: mockDatabaseQueryFactory,
            configManager: mockConfigManager,
            oauthClientCredentialsHelper: mockOauthHelper,
            auditLogger: mockAuditLogger,
            postRequestProcessor: mockPostRequestProcessor,
            requestSpecificCache: mockRequestSpecificCache
        });
    });

    test('forwards valid Parameters payload to matching service and returns response', async () => {
        const parameters = {
            resourceType: 'Parameters',
            parameter: [
                { name: 'resource', resource: { resourceType: 'Patient', id: '123' } },
                { name: 'match', resource: { resourceType: 'Patient', id: '456' } }
            ]
        };

        const result = await personMatchManager.runMatchWithPayloadAsync({
            parameters
        });

        expect(mockPost).toHaveBeenCalledWith('https://match.example.com/$match');
        expect(mockRequest.send).toHaveBeenCalledWith(parameters);
        expect(mockRequest.set).toHaveBeenCalledWith(
            expect.objectContaining({
                Authorization: 'Bearer mock-token'
            })
        );
        expect(result).toEqual({ resourceType: 'Bundle', entry: [] });
    });

    test('rejects payload missing resourceType Parameters', async () => {
        const parameters = {
            resourceType: 'Bundle',
            parameter: [{ name: 'resource', resource: {} }]
        };

        const result = await personMatchManager.runMatchWithPayloadAsync({
            parameters
        });

        expect(result.issue).toBeDefined();
        expect(result.issue[0].severity).toBe('error');
        expect(result.issue[0].diagnostics).toContain('resourceType must be "Parameters"');
        expect(mockPost).not.toHaveBeenCalled();
    });

    test('rejects payload with empty parameter array', async () => {
        const parameters = {
            resourceType: 'Parameters',
            parameter: []
        };

        const result = await personMatchManager.runMatchWithPayloadAsync({
            parameters
        });

        expect(result.issue).toBeDefined();
        expect(result.issue[0].severity).toBe('error');
        expect(result.issue[0].diagnostics).toContain('parameter array must not be empty');
        expect(mockPost).not.toHaveBeenCalled();
    });

    test('rejects payload with missing parameter field', async () => {
        const parameters = {
            resourceType: 'Parameters'
        };

        const result = await personMatchManager.runMatchWithPayloadAsync({
            parameters
        });

        expect(result.issue).toBeDefined();
        expect(result.issue[0].diagnostics).toContain('parameter array must not be empty');
        expect(mockPost).not.toHaveBeenCalled();
    });

    test('returns OperationOutcome on timeout', async () => {
        mockRequest.timeout.mockRejectedValue({ timeout: true });

        const parameters = {
            resourceType: 'Parameters',
            parameter: [{ name: 'resource', resource: { resourceType: 'Patient', id: '123' } }]
        };

        const result = await personMatchManager.runMatchWithPayloadAsync({
            parameters
        });

        expect(result.issue).toBeDefined();
        expect(result.issue[0].code).toBe('timeout');
    });
});
