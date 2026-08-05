'use strict';

const { describe, test, expect, beforeEach, jest: jestObj } = require('@jest/globals');

// Mock heavy dependencies
jestObj.mock('../../../../config', () => ({}));
jestObj.mock('../../../../utils/mongoDatabaseManager', () => ({}));
jestObj.mock('@sentry/node', () => ({ init: jestObj.fn(), captureException: jestObj.fn() }));

jestObj.mock('@opentelemetry/api', () => ({
    trace: {
        getActiveSpan: jestObj.fn()
    }
}));

jestObj.mock('../../../../operations/common/logging', () => ({
    logInfo: jestObj.fn(),
    logDebug: jestObj.fn(),
    logError: jestObj.fn()
}));

// Mock classes with real prototypes so assertTypeEquals passes
jestObj.mock('../../../../operations/graph/graph', () => {
    class GraphOperation {}
    return { GraphOperation };
});
jestObj.mock('../../../../operations/common/fhirLoggingManager', () => {
    class FhirLoggingManager {}
    return { FhirLoggingManager };
});
jestObj.mock('../../../../operations/security/scopesValidator', () => {
    class ScopesValidator {}
    return { ScopesValidator };
});
jestObj.mock('../../../../utils/configManager', () => {
    class ConfigManager {}
    return { ConfigManager };
});
jestObj.mock('../../../../operations/everything/everythingHelper', () => {
    class EverythingHelper {}
    return { EverythingHelper };
});
jestObj.mock('../../../../utils/fhirOperationUsageEventProducer', () => {
    class FhirOperationUsageEventProducer {}
    return { FhirOperationUsageEventProducer };
});
jestObj.mock('../../../../utils/postRequestProcessor', () => {
    class PostRequestProcessor {}
    return { PostRequestProcessor };
});
jestObj.mock('../../../../utils/cmsManager', () => {
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

function buildParsedArgs(overrides = {}) {
    const { ParsedArgs } = require('../../../../operations/query/parsedArgs');
    const parsedArgs = Object.create(ParsedArgs.prototype);
    parsedArgs.base_version = '4_0_0';
    parsedArgs.parsedArgItems = [];
    parsedArgs.originalParsedArgItems = [];
    parsedArgs.headers = { prefer: 'global_id=true' };
    parsedArgs.getRawArgs = jestObj.fn().mockReturnValue({});
    parsedArgs.get = jestObj.fn().mockReturnValue(undefined);
    parsedArgs.getOriginal = jestObj.fn().mockReturnValue(undefined);
    parsedArgs.add = jestObj.fn();
    parsedArgs.remove = jestObj.fn();
    parsedArgs.clone = jestObj.fn().mockReturnValue(parsedArgs);
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

describe('EverythingOperation', () => {
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
        jestObj.clearAllMocks();
        trace.getActiveSpan.mockReturnValue(null);

        mockGraphOperation = Object.create(GraphOperation.prototype);
        mockGraphOperation.graph = jestObj.fn().mockResolvedValue({ entry: [] });

        mockFhirLoggingManager = Object.create(FhirLoggingManager.prototype);
        mockFhirLoggingManager.logOperationSuccessAsync = jestObj.fn().mockResolvedValue(undefined);
        mockFhirLoggingManager.logOperationFailureAsync = jestObj.fn().mockResolvedValue(undefined);

        mockScopesValidator = Object.create(ScopesValidator.prototype);
        mockScopesValidator.verifyHasValidScopesAsync = jestObj.fn().mockResolvedValue(undefined);
        // Default to admin so pre-existing tests (unrelated to the DCON-4808 admin-scope
        // gating) keep exercising their original code path.
        mockScopesValidator.isAdminScope = jestObj.fn().mockReturnValue(true);

        mockConfigManager = Object.create(ConfigManager.prototype);

        mockEverythingHelper = Object.create(EverythingHelper.prototype);
        mockEverythingHelper.retriveEverythingAsync = jestObj.fn().mockResolvedValue({ entry: [] });

        mockFhirOperationUsageEventProducer = Object.create(FhirOperationUsageEventProducer.prototype);
        mockFhirOperationUsageEventProducer.produce = jestObj.fn().mockResolvedValue(undefined);

        mockPostRequestProcessor = Object.create(PostRequestProcessor.prototype);
        mockPostRequestProcessor.add = jestObj.fn();

        mockCmsManager = Object.create(CMSManager.prototype);
        mockCmsManager.sanitizeEverythingParams = jestObj.fn();

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

    describe('constructor', () => {
        test('stores graphOperation dependency', () => {
            expect(operation.graphOperation).toBe(mockGraphOperation);
        });

        test('stores fhirLoggingManager dependency', () => {
            expect(operation.fhirLoggingManager).toBe(mockFhirLoggingManager);
        });

        test('stores scopesValidator dependency', () => {
            expect(operation.scopesValidator).toBe(mockScopesValidator);
        });

        test('stores configManager dependency', () => {
            expect(operation.configManager).toBe(mockConfigManager);
        });

        test('stores everythingHelper dependency', () => {
            expect(operation.everythingHelper).toBe(mockEverythingHelper);
        });

        test('stores fhirOperationUsageEventProducer dependency', () => {
            expect(operation.fhirOperationUsageEventProducer).toBe(mockFhirOperationUsageEventProducer);
        });

        test('stores postRequestProcessor dependency', () => {
            expect(operation.postRequestProcessor).toBe(mockPostRequestProcessor);
        });

        test('stores cmsManager dependency', () => {
            expect(operation.cmsManager).toBe(mockCmsManager);
        });

        test('throws when graphOperation is not a GraphOperation instance', () => {
            expect(() => new EverythingOperation({
                graphOperation: {},
                fhirLoggingManager: mockFhirLoggingManager,
                scopesValidator: mockScopesValidator,
                configManager: mockConfigManager,
                everythingHelper: mockEverythingHelper,
                fhirOperationUsageEventProducer: mockFhirOperationUsageEventProducer,
                postRequestProcessor: mockPostRequestProcessor,
                cmsManager: mockCmsManager
            })).toThrow();
        });

        test('throws when fhirLoggingManager is null', () => {
            expect(() => new EverythingOperation({
                graphOperation: mockGraphOperation,
                fhirLoggingManager: null,
                scopesValidator: mockScopesValidator,
                configManager: mockConfigManager,
                everythingHelper: mockEverythingHelper,
                fhirOperationUsageEventProducer: mockFhirOperationUsageEventProducer,
                postRequestProcessor: mockPostRequestProcessor,
                cmsManager: mockCmsManager
            })).toThrow();
        });
    });

    describe('everythingAsync', () => {
        test('delegates to everythingBundleAsync and returns result', async () => {
            const requestInfo = buildRequestInfo();
            const parsedArgs = buildParsedArgs();

            mockGraphOperation.graph.mockResolvedValue({ entry: [{ id: 'test' }] });

            const result = await operation.everythingAsync({
                requestInfo,
                parsedArgs,
                resourceType: 'Practitioner'
            });

            expect(result).toEqual({ entry: [{ id: 'test' }] });
        });

        test('throws when requestInfo is undefined', async () => {
            const parsedArgs = buildParsedArgs();

            await expect(
                operation.everythingAsync({
                    requestInfo: undefined,
                    parsedArgs,
                    resourceType: 'Patient'
                })
            ).rejects.toThrow();
        });

        test('throws when resourceType is undefined', async () => {
            const requestInfo = buildRequestInfo();
            const parsedArgs = buildParsedArgs();

            await expect(
                operation.everythingAsync({
                    requestInfo,
                    parsedArgs,
                    resourceType: undefined
                })
            ).rejects.toThrow();
        });

        test('logs failure and rethrows when error occurs', async () => {
            const requestInfo = buildRequestInfo();
            const parsedArgs = buildParsedArgs();
            const testError = new Error('graph failed');

            mockGraphOperation.graph.mockRejectedValue(testError);

            await expect(
                operation.everythingAsync({
                    requestInfo,
                    parsedArgs,
                    resourceType: 'Practitioner'
                })
            ).rejects.toThrow('graph failed');

            expect(mockFhirLoggingManager.logOperationFailureAsync).toHaveBeenCalled();
        });
    });

    describe('everythingBundleAsync', () => {
        test('verifies scopes before executing', async () => {
            const requestInfo = buildRequestInfo();
            const parsedArgs = buildParsedArgs();

            await operation.everythingBundleAsync({
                requestInfo,
                parsedArgs,
                resourceType: 'Practitioner'
            });

            expect(mockScopesValidator.verifyHasValidScopesAsync).toHaveBeenCalledWith(
                expect.objectContaining({
                    requestInfo,
                    parsedArgs,
                    resourceType: 'Practitioner',
                    action: 'everything',
                    accessRequested: 'read'
                })
            );
        });

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
        });

        test('uses everythingHelper for Patient GET', async () => {
            const requestInfo = buildRequestInfo({ method: 'GET' });
            const parsedArgs = buildParsedArgs();

            await operation.everythingBundleAsync({
                requestInfo,
                parsedArgs,
                resourceType: 'Patient'
            });

            expect(mockEverythingHelper.retriveEverythingAsync).toHaveBeenCalled();
            expect(mockGraphOperation.graph).not.toHaveBeenCalled();
        });

        // DCON-4808: _explain/_debug/_setIndexHint expose Mongo query plans, collection
        // internals, and let the caller pick the query's index -- everything.js was not
        // previously gating these, unlike history.js/searchBundle.js/searchStreaming.js.
        test('non-admin caller: _explain/_debug/_setIndexHint are cleared before retriveEverythingAsync', async () => {
            mockScopesValidator.isAdminScope.mockReturnValue(false);
            const requestInfo = buildRequestInfo({ method: 'GET' });
            const parsedArgs = buildParsedArgs({ _explain: true, _debug: true, _setIndexHint: 'someIndex' });

            await operation.everythingBundleAsync({
                requestInfo,
                parsedArgs,
                resourceType: 'Patient'
            });

            const receivedArgs = mockEverythingHelper.retriveEverythingAsync.mock.calls[0][0].parsedArgs;
            expect(receivedArgs._explain).toBeUndefined();
            expect(receivedArgs._debug).toBeUndefined();
            expect(receivedArgs._setIndexHint).toBeUndefined();
        });

        test('admin caller: _explain/_debug/_setIndexHint are preserved', async () => {
            mockScopesValidator.isAdminScope.mockReturnValue(true);
            const requestInfo = buildRequestInfo({ method: 'GET' });
            const parsedArgs = buildParsedArgs({ _explain: true, _debug: true, _setIndexHint: 'someIndex' });

            await operation.everythingBundleAsync({
                requestInfo,
                parsedArgs,
                resourceType: 'Patient'
            });

            const receivedArgs = mockEverythingHelper.retriveEverythingAsync.mock.calls[0][0].parsedArgs;
            expect(receivedArgs._explain).toBe(true);
            expect(receivedArgs._debug).toBe(true);
            expect(receivedArgs._setIndexHint).toBe('someIndex');
        });

        test('uses graphOperation for Practitioner', async () => {
            const requestInfo = buildRequestInfo({ method: 'GET' });
            const parsedArgs = buildParsedArgs();

            await operation.everythingBundleAsync({
                requestInfo,
                parsedArgs,
                resourceType: 'Practitioner'
            });

            expect(mockGraphOperation.graph).toHaveBeenCalled();
            expect(mockEverythingHelper.retriveEverythingAsync).not.toHaveBeenCalled();
        });

        test('uses graphOperation for Organization', async () => {
            const requestInfo = buildRequestInfo({ method: 'GET' });
            const parsedArgs = buildParsedArgs();

            await operation.everythingBundleAsync({
                requestInfo,
                parsedArgs,
                resourceType: 'Organization'
            });

            expect(mockGraphOperation.graph).toHaveBeenCalled();
        });

        test('uses graphOperation for Slot', async () => {
            const requestInfo = buildRequestInfo({ method: 'GET' });
            const parsedArgs = buildParsedArgs();

            await operation.everythingBundleAsync({
                requestInfo,
                parsedArgs,
                resourceType: 'Slot'
            });

            expect(mockGraphOperation.graph).toHaveBeenCalled();
        });

        test('throws for unsupported resource type', async () => {
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

        test('returns undefined when responseStreamer is provided', async () => {
            const requestInfo = buildRequestInfo({ method: 'GET' });
            const parsedArgs = buildParsedArgs();
            const responseStreamer = { stream: jestObj.fn() };

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

        test('logs success on successful completion', async () => {
            const requestInfo = buildRequestInfo({ method: 'GET' });
            const parsedArgs = buildParsedArgs();

            await operation.everythingBundleAsync({
                requestInfo,
                parsedArgs,
                resourceType: 'Practitioner'
            });

            expect(mockFhirLoggingManager.logOperationSuccessAsync).toHaveBeenCalledWith(
                expect.objectContaining({
                    requestInfo,
                    resourceType: 'Practitioner',
                    action: 'everything'
                })
            );
        });

        test('logs failure when error occurs in graph path', async () => {
            const requestInfo = buildRequestInfo({ method: 'GET' });
            const parsedArgs = buildParsedArgs();

            mockGraphOperation.graph.mockRejectedValue(new Error('db error'));

            await expect(
                operation.everythingBundleAsync({
                    requestInfo,
                    parsedArgs,
                    resourceType: 'Practitioner'
                })
            ).rejects.toThrow('db error');

            expect(mockFhirLoggingManager.logOperationFailureAsync).toHaveBeenCalled();
        });

        test('sets activeSpan attribute when masterPersonId is present', async () => {
            const mockSpan = { setAttribute: jestObj.fn() };
            trace.getActiveSpan.mockReturnValue(mockSpan);

            const requestInfo = buildRequestInfo({
                method: 'GET',
                masterPersonIdFromJwtToken: 'master-123'
            });
            const parsedArgs = buildParsedArgs();

            await operation.everythingBundleAsync({
                requestInfo,
                parsedArgs,
                resourceType: 'Practitioner'
            });

            expect(mockSpan.setAttribute).toHaveBeenCalledWith('master.person.id', 'master-123');
        });

        test('adds postRequestProcessor task when isUser and Patient everything', async () => {
            const requestInfo = buildRequestInfo({
                isUser: true,
                method: 'GET',
                personIdFromJwtToken: 'person-123',
                masterPersonIdFromJwtToken: 'master-456',
                managingOrganizationId: 'org-789',
                requestId: 'req-abc'
            });
            const parsedArgs = buildParsedArgs();

            await operation.everythingBundleAsync({
                requestInfo,
                parsedArgs,
                resourceType: 'Patient'
            });

            expect(mockPostRequestProcessor.add).toHaveBeenCalledWith(
                expect.objectContaining({ requestId: 'req-abc' })
            );
        });

        test('does not add postRequestProcessor task for non-user requests', async () => {
            const requestInfo = buildRequestInfo({ isUser: false, method: 'GET' });
            const parsedArgs = buildParsedArgs();

            await operation.everythingBundleAsync({
                requestInfo,
                parsedArgs,
                resourceType: 'Patient'
            });

            expect(mockPostRequestProcessor.add).not.toHaveBeenCalled();
        });

        test('calls cmsManager.sanitizeEverythingParams for Patient', async () => {
            const requestInfo = buildRequestInfo({ method: 'GET' });
            const parsedArgs = buildParsedArgs();

            await operation.everythingBundleAsync({
                requestInfo,
                parsedArgs,
                resourceType: 'Patient'
            });

            expect(mockCmsManager.sanitizeEverythingParams).toHaveBeenCalledWith({
                requestInfo,
                parsedArgs
            });
        });

        test('removes _since when it does not match INSTANT regex for Patient', async () => {
            const requestInfo = buildRequestInfo({ method: 'GET' });
            const parsedArgs = buildParsedArgs({ _since: 'bad-date' });

            await operation.everythingBundleAsync({
                requestInfo,
                parsedArgs,
                resourceType: 'Patient'
            });

            expect(parsedArgs.remove).toHaveBeenCalledWith('_since');
            expect(parsedArgs._since).toBeNull();
        });

        test('uses Patient deletion graph for Patient DELETE', async () => {
            const requestInfo = buildRequestInfo({ method: 'DELETE', isUser: false });
            const parsedArgs = buildParsedArgs();

            await operation.everythingBundleAsync({
                requestInfo,
                parsedArgs,
                resourceType: 'Patient'
            });

            expect(mockGraphOperation.graph).toHaveBeenCalled();
            expect(mockEverythingHelper.retriveEverythingAsync).not.toHaveBeenCalled();
        });

        test('sets _type filter to parsedArgs.contained=0 and resourceFilterList', async () => {
            const requestInfo = buildRequestInfo({ method: 'GET' });
            const parsedArgs = buildParsedArgs({ _type: 'Observation,Condition' });

            await operation.everythingBundleAsync({
                requestInfo,
                parsedArgs,
                resourceType: 'Patient'
            });

            expect(parsedArgs.contained).toBe(0);
            expect(parsedArgs.resourceFilterList).toEqual(['Observation', 'Condition']);
        });
    });
});
