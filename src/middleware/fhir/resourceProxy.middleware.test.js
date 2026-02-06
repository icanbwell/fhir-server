/**
 * Tests for resourceProxy.middleware.js
 */
const {createResourceProxyMiddleware} = require('./resourceProxy.middleware');
const {ConfigManager} = require('../../utils/configManager');
const axios = require('axios');
const {describe, test, expect, jest, beforeEach, afterEach} = require('@jest/globals');

// Mock axios
jest.mock('axios');

describe('Resource Proxy Middleware', () => {
    let mockConfigManager;
    let mockReq;
    let mockRes;
    let mockNext;

    beforeEach(() => {
        // Reset mocks
        jest.clearAllMocks();

        // Mock ConfigManager
        mockConfigManager = new ConfigManager();
        mockConfigManager.observationServiceUrl = 'http://observation-service:3001';
        mockConfigManager.internalServiceSecret = 'test-secret';

        // Mock Express request
        mockReq = {
            path: '/4_0_0/Observation',
            method: 'GET',
            query: {subject: 'Patient/123'},
            body: {},
            headers: {
                authorization: 'Bearer test-token',
                'content-type': 'application/fhir+json'
            },
            user: {
                username: 'test-user',
                scope: ['user/*.read', 'access/test.*'],
                access: ['test'],
                clientFhirPersonId: 'person-123'
            },
            id: 'request-123'
        };

        // Mock Express response
        mockRes = {
            status: jest.fn().mockReturnThis(),
            send: jest.fn().mockReturnThis(),
            setHeader: jest.fn().mockReturnThis()
        };

        // Mock Express next
        mockNext = jest.fn();
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    test('should pass through requests for resources without configured backend service', async () => {
        const middleware = createResourceProxyMiddleware(mockConfigManager);
        mockReq.path = '/4_0_0/Patient';

        await middleware(mockReq, mockRes, mockNext);

        expect(mockNext).toHaveBeenCalled();
        expect(axios).not.toHaveBeenCalled();
    });

    test('should proxy requests to configured backend service', async () => {
        const mockBackendResponse = {
            status: 200,
            data: {
                resourceType: 'Bundle',
                type: 'searchset',
                total: 1,
                entry: []
            },
            headers: {
                'content-type': 'application/fhir+json'
            }
        };

        axios.mockResolvedValue(mockBackendResponse);

        const middleware = createResourceProxyMiddleware(mockConfigManager);
        await middleware(mockReq, mockRes, mockNext);

        expect(axios).toHaveBeenCalledWith(expect.objectContaining({
            method: 'GET',
            url: 'http://observation-service:3001/4_0_0/Observation',
            params: {subject: 'Patient/123'},
            headers: expect.objectContaining({
                'Authorization': 'Bearer test-token',
                'X-User-Scopes': JSON.stringify(['user/*.read', 'access/test.*']),
                'X-Access-Codes': JSON.stringify(['test']),
                'X-Client-Person-Id': 'person-123',
                'X-Internal-Secret': 'test-secret'
            })
        }));

        expect(mockNext).not.toHaveBeenCalled();
        expect(mockRes.status).toHaveBeenCalledWith(200);
        expect(mockRes.send).toHaveBeenCalledWith(mockBackendResponse.data);
    });

    test('should handle backend service errors', async () => {
        axios.mockRejectedValue({
            response: {
                status: 500,
                data: {
                    resourceType: 'OperationOutcome',
                    issue: [{
                        severity: 'error',
                        code: 'exception',
                        diagnostics: 'Internal server error'
                    }]
                }
            }
        });

        const middleware = createResourceProxyMiddleware(mockConfigManager);
        await middleware(mockReq, mockRes, mockNext);

        expect(mockRes.status).toHaveBeenCalledWith(500);
        expect(mockRes.send).toHaveBeenCalledWith(expect.objectContaining({
            resourceType: 'OperationOutcome'
        }));
    });

    test('should handle connection refused errors', async () => {
        axios.mockRejectedValue({
            code: 'ECONNREFUSED',
            message: 'Connection refused'
        });

        const middleware = createResourceProxyMiddleware(mockConfigManager);
        await middleware(mockReq, mockRes, mockNext);

        expect(mockRes.status).toHaveBeenCalledWith(503);
        expect(mockRes.send).toHaveBeenCalledWith(expect.objectContaining({
            resourceType: 'OperationOutcome',
            issue: expect.arrayContaining([
                expect.objectContaining({
                    code: 'timeout',
                    diagnostics: expect.stringContaining('unavailable')
                })
            ])
        }));
    });

    test('should handle timeout errors', async () => {
        axios.mockRejectedValue({
            code: 'ETIMEDOUT',
            message: 'Timeout'
        });

        const middleware = createResourceProxyMiddleware(mockConfigManager);
        await middleware(mockReq, mockRes, mockNext);

        expect(mockRes.status).toHaveBeenCalledWith(504);
        expect(mockRes.send).toHaveBeenCalledWith(expect.objectContaining({
            resourceType: 'OperationOutcome',
            issue: expect.arrayContaining([
                expect.objectContaining({
                    code: 'timeout',
                    diagnostics: expect.stringContaining('timed out')
                })
            ])
        }));
    });

    test('should forward relevant headers from backend response', async () => {
        const mockBackendResponse = {
            status: 200,
            data: {resourceType: 'Observation', id: '123'},
            headers: {
                'content-type': 'application/fhir+json',
                'etag': 'W/"1"',
                'last-modified': 'Wed, 01 Jan 2024 00:00:00 GMT',
                'x-custom-header': 'should-not-be-forwarded'
            }
        };

        axios.mockResolvedValue(mockBackendResponse);

        const middleware = createResourceProxyMiddleware(mockConfigManager);
        await middleware(mockReq, mockRes, mockNext);

        expect(mockRes.setHeader).toHaveBeenCalledWith('content-type', 'application/fhir+json');
        expect(mockRes.setHeader).toHaveBeenCalledWith('etag', 'W/"1"');
        expect(mockRes.setHeader).toHaveBeenCalledWith('last-modified', 'Wed, 01 Jan 2024 00:00:00 GMT');
    });

    test('should handle POST requests with body', async () => {
        const mockBackendResponse = {
            status: 201,
            data: {resourceType: 'Observation', id: '123'},
            headers: {
                'content-type': 'application/fhir+json',
                'location': '/4_0_0/Observation/123'
            }
        };

        axios.mockResolvedValue(mockBackendResponse);

        mockReq.method = 'POST';
        mockReq.body = {
            resourceType: 'Observation',
            status: 'final',
            code: {coding: [{system: 'http://loinc.org', code: '8867-4'}]}
        };

        const middleware = createResourceProxyMiddleware(mockConfigManager);
        await middleware(mockReq, mockRes, mockNext);

        expect(axios).toHaveBeenCalledWith(expect.objectContaining({
            method: 'POST',
            data: mockReq.body
        }));

        expect(mockRes.status).toHaveBeenCalledWith(201);
    });

    test('should handle requests without user context', async () => {
        const mockBackendResponse = {
            status: 200,
            data: {resourceType: 'Bundle', entry: []},
            headers: {}
        };

        axios.mockResolvedValue(mockBackendResponse);

        mockReq.user = null;

        const middleware = createResourceProxyMiddleware(mockConfigManager);
        await middleware(mockReq, mockRes, mockNext);

        expect(axios).toHaveBeenCalledWith(expect.objectContaining({
            headers: expect.objectContaining({
                'X-User-Scopes': JSON.stringify([]),
                'X-Access-Codes': JSON.stringify([])
            })
        }));
    });

    test('should not include internal secret if not configured', async () => {
        const mockBackendResponse = {
            status: 200,
            data: {resourceType: 'Bundle', entry: []},
            headers: {}
        };

        axios.mockResolvedValue(mockBackendResponse);

        mockConfigManager.internalServiceSecret = null;

        const middleware = createResourceProxyMiddleware(mockConfigManager);
        await middleware(mockReq, mockRes, mockNext);

        const axiosCall = axios.mock.calls[0][0];
        expect(axiosCall.headers['X-Internal-Secret']).toBeUndefined();
    });

    test('should handle paths with resource IDs', async () => {
        const mockBackendResponse = {
            status: 200,
            data: {resourceType: 'Observation', id: '123'},
            headers: {}
        };

        axios.mockResolvedValue(mockBackendResponse);

        mockReq.path = '/4_0_0/Observation/123';

        const middleware = createResourceProxyMiddleware(mockConfigManager);
        await middleware(mockReq, mockRes, mockNext);

        expect(axios).toHaveBeenCalledWith(expect.objectContaining({
            url: 'http://observation-service:3001/4_0_0/Observation/123'
        }));
    });

    test('should handle metadata endpoint without proxying', async () => {
        mockReq.path = '/4_0_0/metadata';

        const middleware = createResourceProxyMiddleware(mockConfigManager);
        await middleware(mockReq, mockRes, mockNext);

        expect(mockNext).toHaveBeenCalled();
        expect(axios).not.toHaveBeenCalled();
    });
});
