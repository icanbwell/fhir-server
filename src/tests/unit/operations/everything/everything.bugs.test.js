'use strict';

const { describe, test, expect, beforeEach, jest } = require('@jest/globals');

// Mock heavy dependencies
jest.mock('../../../../config', () => ({}));
jest.mock('../../../../utils/mongoDatabaseManager', () => ({}));
jest.mock('@sentry/node', () => ({ init: jest.fn(), captureException: jest.fn() }));

jest.mock('@opentelemetry/api', () => ({
    trace: {
        getActiveSpan: jest.fn()
    }
}));

jest.mock('../../../../operations/common/logging', () => ({
    logInfo: jest.fn(),
    logDebug: jest.fn(),
    logError: jest.fn()
}));

// Mock classes with real prototypes so assertTypeEquals passes
jest.mock('../../../../operations/graph/graph', () => {
    class GraphOperation {}
    return { GraphOperation };
});
jest.mock('../../../../operations/common/fhirLoggingManager', () => {
    class FhirLoggingManager {}
    return { FhirLoggingManager };
});
jest.mock('../../../../operations/security/scopesValidator', () => {
    class ScopesValidator {}
    return { ScopesValidator };
});
jest.mock('../../../../utils/configManager', () => {
    class ConfigManager {}
    return { ConfigManager };
});
jest.mock('../../../../operations/everything/everythingHelper', () => {
    class EverythingHelper {}
    return { EverythingHelper };
});
jest.mock('../../../../utils/fhirOperationUsageEventProducer', () => {
    class FhirOperationUsageEventProducer {}
    return { FhirOperationUsageEventProducer };
});
jest.mock('../../../../utils/postRequestProcessor', () => {
    class PostRequestProcessor {}
    return { PostRequestProcessor };
});
jest.mock('../../../../utils/cmsManager', () => {
    class CMSManager {}
    return { CMSManager };
});

const { trace } = require('@opentelemetry/api');
const { EverythingOperation } = require('../../../../operations/everything/everything');
const { GraphOperation } = require('../../../../operations/graph/graph');
const { FhirLoggingManager } = require('../../../../operations/common/fhirLoggingManager');
const { ScopesValidator } = require('../../../../operations/security/scopesValidator');
const { ConfigManager } = require('../../../../utils/configManager');
const { EverythingHelper } = require('../../../../operations/everything/everythingHelper');
const { FhirOperationUsageEventProducer } = require('../../../../utils/fhirOperationUsageEventProducer');
const { PostRequestProcessor } = require('../../../../utils/postRequestProcessor');
const { CMSManager } = require('../../../../utils/cmsManager');

/**
 * Build a minimal ParsedArgs-like stub.
 */
function buildParsedArgs(overrides = {}) {
    const { ParsedArgs } = require('../../../../operations/query/parsedArgs');
    const parsedArgs = Object.create(ParsedArgs.prototype);
    parsedArgs.base_version = '4_0_0';
    parsedArgs.parsedArgItems = [];
    parsedArgs.originalParsedArgItems = [];
    parsedArgs.headers = { prefer: 'global_id=true' };
    parsedArgs.getRawArgs = jest.fn().mockReturnValue({});
    parsedArgs.get = jest.fn().mockReturnValue(undefined);
    parsedArgs.getOriginal = jest.fn().mockReturnValue(undefined);
    parsedArgs.add = jest.fn();
    parsedArgs.remove = jest.fn();
    parsedArgs.clone = jest.fn().mockReturnValue(parsedArgs);
    parsedArgs.resourceFilterList = undefined;
    parsedArgs._since = null;
    parsedArgs._includePatientLinkedOnly = undefined;
    parsedArgs._rewritePatientReference = undefined;
    parsedArgs._explain = false;
    parsedArgs._debug = false;
    parsedArgs._type = undefined;
    parsedArgs.contained = undefined;
    Object.assign(parsedArgs, overrides);
    return parsedArgs;
}

function buildRequestInfo(overrides = {}) {
    return {
        method: 'GET',
        user: 'test-user',
        scope: 'patient/*.read',
        isUser: false,
        userType: null,
        personIdFromJwtToken: null,
        masterPersonIdFromJwtToken: null,
        managingOrganizationId: null,
        requestId: 'req-test',
        userRequestId: 'user-req-test',
        host: 'localhost',
        protocol: 'https',
        actor: null,
        ...overrides
    };
}

describe('EverythingOperation - bug hunting', () => {
    let operation;
    let mockGraphOperation;
    let mockFhirLoggingManager;
    let mockScopesValidator;
    let mockConfigManager;
    let mockEverythingHelper;
    let mockFhirOperationUsageEventProducer;
    let mockPostRequestProcessor;
    let mockCmsManager;

    beforeEach(() => {
        jest.clearAllMocks();
        trace.getActiveSpan.mockReturnValue(null);

        mockGraphOperation = Object.create(GraphOperation.prototype);
        mockGraphOperation.graph = jest.fn().mockResolvedValue({ entry: [] });

        mockFhirLoggingManager = Object.create(FhirLoggingManager.prototype);
        mockFhirLoggingManager.logOperationSuccessAsync = jest.fn().mockResolvedValue(undefined);
        mockFhirLoggingManager.logOperationFailureAsync = jest.fn().mockResolvedValue(undefined);

        mockScopesValidator = Object.create(ScopesValidator.prototype);
        mockScopesValidator.verifyHasValidScopesAsync = jest.fn().mockResolvedValue(undefined);

        mockConfigManager = Object.create(ConfigManager.prototype);

        mockEverythingHelper = Object.create(EverythingHelper.prototype);
        mockEverythingHelper.retriveEverythingAsync = jest.fn().mockResolvedValue({ entry: [] });

        mockFhirOperationUsageEventProducer = Object.create(FhirOperationUsageEventProducer.prototype);
        mockFhirOperationUsageEventProducer.produce = jest.fn().mockResolvedValue(undefined);

        mockPostRequestProcessor = Object.create(PostRequestProcessor.prototype);
        mockPostRequestProcessor.add = jest.fn();

        mockCmsManager = Object.create(CMSManager.prototype);
        mockCmsManager.sanitizeEverythingParams = jest.fn();

        operation = new EverythingOperation({
            graphOperation: mockGraphOperation,
            fhirLoggingManager: mockFhirLoggingManager,
            scopesValidator: mockScopesValidator,
            configManager: mockConfigManager,
            everythingHelper: mockEverythingHelper,
            fhirOperationUsageEventProducer: mockFhirOperationUsageEventProducer,
            postRequestProcessor: mockPostRequestProcessor,
            cmsManager: mockCmsManager
        });
    });

    describe('ForbiddenError for user DELETE', () => {
        test('throws ForbiddenError when isUser and method is delete', async () => {
            const requestInfo = buildRequestInfo({ isUser: true, method: 'DELETE' });
            const parsedArgs = buildParsedArgs();

            await expect(
                operation.everythingBundleAsync({
                    requestInfo,
                    parsedArgs,
                    resourceType: 'Patient'
                })
            ).rejects.toThrow('failed access check to delete');

            expect(mockFhirLoggingManager.logOperationFailureAsync).toHaveBeenCalled();
        });
    });

    describe('unsupported resourceType', () => {
        test('throws Error for unsupported resource type in graph path', async () => {
            const requestInfo = buildRequestInfo({ method: 'GET' });
            const parsedArgs = buildParsedArgs();

            await expect(
                operation.everythingBundleAsync({
                    requestInfo,
                    parsedArgs,
                    resourceType: 'Medication'
                })
            ).rejects.toThrow('$everything is not supported for resource: Medication');
        });
    });

    describe('Person everything with GET returns null graph', () => {
        test('Person GET sets resource to null and passes to graphOperation', async () => {
            const requestInfo = buildRequestInfo({ method: 'GET' });
            const parsedArgs = buildParsedArgs();

            // BUG: For Person with GET, parsedArgs.resource is set to null (line 272).
            // Then if resourceFilter is truthy, filterGraphResources is called with
            // deepcopy(null) which could throw. Let's test the normal path.
            await operation.everythingBundleAsync({
                requestInfo,
                parsedArgs,
                resourceType: 'Person'
            });

            // graph is called with parsedArgs.resource = null
            expect(mockGraphOperation.graph).toHaveBeenCalledWith(
                expect.objectContaining({
                    resourceType: 'Person'
                })
            );
            expect(parsedArgs.resource).toBeNull();
        });
    });

    describe('Person/Patient GET with _type filter on null graph - null dereference bug', () => {
        test('throws TypeError when _type filter is applied to Person GET (null resource graph)', async () => {
            const requestInfo = buildRequestInfo({ method: 'GET' });
            // _type filter causes filterGraphResources(deepcopy(null), ...) which crashes
            const parsedArgs = buildParsedArgs({ _type: 'Observation' });

            // BUG: parsedArgs.resource is set to null for Person/GET (line 272),
            // then at line 289: filterGraphResources(deepcopy(parsedArgs.resource), ...)
            // deepcopy(null) returns null, then filterGraphResources(null, ...) tries to
            // access null.link which throws TypeError: Cannot read properties of null
            await expect(
                operation.everythingBundleAsync({
                    requestInfo,
                    parsedArgs,
                    resourceType: 'Person'
                })
            ).rejects.toThrow(TypeError);
        });
    });

    describe('_since validation', () => {
        test('removes _since when it does not match INSTANT regex for Patient', async () => {
            const requestInfo = buildRequestInfo({ method: 'GET' });
            const parsedArgs = buildParsedArgs({ _since: 'invalid-date-format' });

            await operation.everythingBundleAsync({
                requestInfo,
                parsedArgs,
                resourceType: 'Patient'
            });

            // _since should be cleared when it doesn't match INSTANT regex
            expect(parsedArgs.remove).toHaveBeenCalledWith('_since');
            expect(parsedArgs._since).toBeNull();
        });
    });

    describe('responseStreamer behavior', () => {
        test('returns undefined when responseStreamer is provided', async () => {
            const requestInfo = buildRequestInfo({ method: 'GET' });
            const parsedArgs = buildParsedArgs();
            const responseStreamer = { stream: jest.fn() };

            const result = await operation.everythingBundleAsync({
                requestInfo,
                parsedArgs,
                resourceType: 'Practitioner',
                responseStreamer
            });

            expect(result).toBeUndefined();
        });

        test('returns result when no responseStreamer', async () => {
            const requestInfo = buildRequestInfo({ method: 'GET' });
            const parsedArgs = buildParsedArgs();

            mockGraphOperation.graph.mockResolvedValue({ entry: [{ id: '1' }] });

            const result = await operation.everythingBundleAsync({
                requestInfo,
                parsedArgs,
                resourceType: 'Practitioner'
            });

            expect(result).toEqual({ entry: [{ id: '1' }] });
        });
    });

    describe('error handling - double logging in everythingAsync', () => {
        test('everythingAsync logs failure when everythingBundleAsync throws', async () => {
            const requestInfo = buildRequestInfo({ method: 'GET' });
            const parsedArgs = buildParsedArgs();
            const testError = new Error('test error');

            mockGraphOperation.graph.mockRejectedValue(testError);

            await expect(
                operation.everythingAsync({
                    requestInfo,
                    parsedArgs,
                    resourceType: 'Practitioner'
                })
            ).rejects.toThrow('test error');

            // BUG: logOperationFailureAsync is called TWICE for the same error:
            // 1. Once in everythingBundleAsync catch block (line 335)
            // 2. Once in everythingAsync catch block (line 116)
            // This causes duplicate error logging/metrics.
            expect(mockFhirLoggingManager.logOperationFailureAsync).toHaveBeenCalledTimes(2);
        });
    });

    describe('postRequestProcessor for user Patient everything', () => {
        test('adds usage event task when isUser and Patient everything', async () => {
            const requestInfo = buildRequestInfo({
                isUser: true,
                method: 'GET',
                personIdFromJwtToken: 'person-123',
                masterPersonIdFromJwtToken: 'master-456',
                managingOrganizationId: 'org-789'
            });
            const parsedArgs = buildParsedArgs();

            await operation.everythingBundleAsync({
                requestInfo,
                parsedArgs,
                resourceType: 'Patient'
            });

            expect(mockPostRequestProcessor.add).toHaveBeenCalledWith(
                expect.objectContaining({ requestId: 'req-test' })
            );
        });
    });
});
