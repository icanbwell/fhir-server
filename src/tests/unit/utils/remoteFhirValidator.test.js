const { describe, test, expect, beforeEach, jest: jestObj } = require('@jest/globals');

// Mock superagent
const mockRequest = {
    get: jestObj.fn(),
    post: jestObj.fn(),
    put: jestObj.fn(),
    set: jestObj.fn(),
    retry: jestObj.fn(),
    timeout: jestObj.fn(),
    send: jestObj.fn()
};

// Chain all methods to return mockRequest for fluent API
mockRequest.get.mockReturnValue(mockRequest);
mockRequest.post.mockReturnValue(mockRequest);
mockRequest.put.mockReturnValue(mockRequest);
mockRequest.set.mockReturnValue(mockRequest);
mockRequest.retry.mockReturnValue(mockRequest);
mockRequest.timeout.mockReturnValue(mockRequest);
mockRequest.send.mockReturnValue(mockRequest);

jestObj.mock('superagent', () => mockRequest);

jestObj.mock('../../../operations/common/logging', () => ({
    logInfo: jestObj.fn(),
    logError: jestObj.fn()
}));

jestObj.mock('../../../utils/assertType', () => ({
    assertIsValid: jestObj.fn((val, msg) => {
        if (!val) {
            throw new Error(msg);
        }
    }),
    assertTypeEquals: jestObj.fn()
}));

jestObj.mock('../../../utils/urlParser', () => ({
    validateUrl: jestObj.fn()
}));

const { RemoteFhirValidator } = require('../../../utils/remoteFhirValidator');

describe('RemoteFhirValidator', () => {
    let validator;
    let mockConfigManager;
    let mockProfileUrlMapper;

    beforeEach(() => {
        jestObj.clearAllMocks();

        mockConfigManager = {
            environmentValue: 'test',
            fhirValidationUrl: 'http://hapi-fhir:8080/fhir',
            requestTimeoutMs: 30000
        };

        mockProfileUrlMapper = {
            getOriginalUrl: jestObj.fn((url) => url)
        };

        validator = new RemoteFhirValidator({
            configManager: mockConfigManager,
            profileUrlMapper: mockProfileUrlMapper
        });

        // Reset the chain for each test
        mockRequest.get.mockReturnValue(mockRequest);
        mockRequest.post.mockReturnValue(mockRequest);
        mockRequest.put.mockReturnValue(mockRequest);
        mockRequest.set.mockReturnValue(mockRequest);
        mockRequest.retry.mockReturnValue(mockRequest);
        mockRequest.timeout.mockReturnValue(mockRequest);
        mockRequest.send.mockReturnValue(mockRequest);
    });

    describe('fetchProfileAsync', () => {
        test('throws error when url is not specified', async () => {
            await expect(validator.fetchProfileAsync({ url: '' }))
                .rejects.toThrow('url must be specified');
        });

        test('fetches profile from remote server with correct headers', async () => {
            const expectedBody = { resourceType: 'StructureDefinition', id: 'test' };
            mockRequest.timeout.mockResolvedValue({ body: expectedBody });

            const result = await validator.fetchProfileAsync({ url: 'http://example.com/profile' });

            expect(result).toEqual(expectedBody);
            expect(mockRequest.get).toHaveBeenCalledWith('http://example.com/profile');
            expect(mockRequest.set).toHaveBeenCalledWith('Accept', 'application/json');
            expect(mockRequest.set).toHaveBeenCalledWith('User-Agent', 'fhir-server/test');
            expect(mockRequest.retry).toHaveBeenCalledWith(3);
            expect(mockRequest.timeout).toHaveBeenCalledWith(30000);
        });

        test('uses profileUrlMapper to get the original URL', async () => {
            mockProfileUrlMapper.getOriginalUrl.mockReturnValue('http://mapped-url.com/profile');
            mockRequest.timeout.mockResolvedValue({ body: {} });

            await validator.fetchProfileAsync({ url: 'http://canonical.com/profile' });

            expect(mockProfileUrlMapper.getOriginalUrl).toHaveBeenCalledWith('http://canonical.com/profile');
            expect(mockRequest.get).toHaveBeenCalledWith('http://mapped-url.com/profile');
        });

        test('throws error with statusCode 504 on timeout', async () => {
            const timeoutError = new Error('Timeout');
            timeoutError.timeout = true;
            mockRequest.timeout.mockRejectedValue(timeoutError);

            await expect(validator.fetchProfileAsync({ url: 'http://example.com/profile' }))
                .rejects.toMatchObject({ statusCode: 504 });
        });

        test('thrown timeout error includes profileUrl info', async () => {
            const timeoutError = new Error('Timeout');
            timeoutError.timeout = true;
            mockRequest.timeout.mockRejectedValue(timeoutError);

            await expect(validator.fetchProfileAsync({ url: 'http://example.com/profile' }))
                .rejects.toMatchObject({
                    profileUrl: 'http://example.com/profile',
                    timeout: 30000
                });
        });

        test('rethrows non-timeout errors', async () => {
            const genericError = new Error('Network failure');
            mockRequest.timeout.mockRejectedValue(genericError);

            await expect(validator.fetchProfileAsync({ url: 'http://example.com/profile' }))
                .rejects.toThrow('Network failure');
        });
    });

    describe('updateProfileAsync', () => {
        test('throws when fhirValidationUrl is not configured', async () => {
            mockConfigManager.fhirValidationUrl = '';

            await expect(validator.updateProfileAsync({ profileJson: { id: 'test' } }))
                .rejects.toThrow('fhirValidationUrl must be specified');
        });

        test('sends PUT request to correct URL with profile data', async () => {
            const profileJson = { id: 'my-profile', resourceType: 'StructureDefinition' };
            const expectedBody = { success: true };
            mockRequest.send.mockResolvedValue({ body: expectedBody });

            const result = await validator.updateProfileAsync({ profileJson });

            expect(result).toEqual(expectedBody);
            expect(mockRequest.put).toHaveBeenCalledWith(
                'http://hapi-fhir:8080/fhir/StructureDefinition/my-profile'
            );
            expect(mockRequest.set).toHaveBeenCalledWith('Accept', 'application/json');
            expect(mockRequest.set).toHaveBeenCalledWith('Content-Type', 'application/fhir+json');
            expect(mockRequest.send).toHaveBeenCalledWith(profileJson);
        });

        test('throws error with statusCode 504 on timeout', async () => {
            const timeoutError = new Error('Timeout');
            timeoutError.timeout = true;
            mockRequest.send.mockRejectedValue(timeoutError);

            await expect(validator.updateProfileAsync({ profileJson: { id: 'test' } }))
                .rejects.toMatchObject({ statusCode: 504 });
        });

        test('rethrows non-timeout errors', async () => {
            const genericError = new Error('Server error');
            mockRequest.send.mockRejectedValue(genericError);

            await expect(validator.updateProfileAsync({ profileJson: { id: 'test' } }))
                .rejects.toThrow('Server error');
        });
    });

    describe('validateResourceAsync', () => {
        test('returns OperationOutcome when resourceType does not match resourceName', async () => {
            const result = await validator.validateResourceAsync({
                resourceBody: { resourceType: 'Patient' },
                resourceName: 'Observation',
                path: '/4_0_0/Observation',
                profile: undefined
            });

            expect(result.issue).toBeDefined();
            expect(result.issue[0].severity).toBe('error');
            expect(result.issue[0].code).toBe('invalid');
            expect(result.issue[0].details.text).toContain('ResourceType does not match');
        });

        test('calls remote validation endpoint with correct URL when types match', async () => {
            const resourceBody = { resourceType: 'Patient', id: '123' };
            const expectedResponse = { resourceType: 'OperationOutcome', issue: [] };
            mockRequest.send.mockResolvedValue({ body: expectedResponse });

            const result = await validator.validateResourceAsync({
                resourceBody,
                resourceName: 'Patient',
                path: '/4_0_0/Patient',
                profile: undefined
            });

            expect(result).toEqual(expectedResponse);
            expect(mockRequest.post).toHaveBeenCalledWith(
                'http://hapi-fhir:8080/fhir/Patient/$validate'
            );
            expect(mockRequest.send).toHaveBeenCalledWith(resourceBody);
        });

        test('appends profile parameter when profile is provided', async () => {
            const resourceBody = { resourceType: 'Patient', id: '123' };
            mockRequest.send.mockResolvedValue({ body: {} });

            await validator.validateResourceAsync({
                resourceBody,
                resourceName: 'Patient',
                path: '/4_0_0/Patient',
                profile: 'http://hl7.org/fhir/us/core/StructureDefinition/us-core-patient'
            });

            expect(mockRequest.post).toHaveBeenCalledWith(
                expect.stringContaining('profile=')
            );
        });

        test('throws error with statusCode 504 on timeout', async () => {
            const timeoutError = new Error('Timeout');
            timeoutError.timeout = true;
            mockRequest.send.mockRejectedValue(timeoutError);

            await expect(validator.validateResourceAsync({
                resourceBody: { resourceType: 'Patient' },
                resourceName: 'Patient',
                path: '/4_0_0/Patient',
                profile: undefined
            })).rejects.toMatchObject({ statusCode: 504 });
        });

        test('rethrows non-timeout errors during validation', async () => {
            const genericError = new Error('Connection refused');
            mockRequest.send.mockRejectedValue(genericError);

            await expect(validator.validateResourceAsync({
                resourceBody: { resourceType: 'Patient' },
                resourceName: 'Patient',
                path: '/4_0_0/Patient',
                profile: undefined
            })).rejects.toThrow('Connection refused');
        });

        test('throws when fhirValidationUrl is not configured', async () => {
            mockConfigManager.fhirValidationUrl = '';

            await expect(validator.validateResourceAsync({
                resourceBody: { resourceType: 'Patient' },
                resourceName: 'Patient',
                path: '/4_0_0/Patient',
                profile: undefined
            })).rejects.toThrow('fhirValidationUrl must be specified');
        });

        test('error message includes the path and resourceType on type mismatch', async () => {
            const result = await validator.validateResourceAsync({
                resourceBody: { resourceType: 'Observation' },
                resourceName: 'Patient',
                path: '/4_0_0/Patient/123',
                profile: undefined
            });

            expect(result.issue[0].details.text).toContain('/4_0_0/Patient/123');
            expect(result.issue[0].details.text).toContain('Observation');
        });
    });
});
