/**
 * Unit tests for EA-2308: verify that everythingBundleAsync emits bwellFhirPersonId
 * as an OTel span attribute and structured log field.
 */

const { describe, test, expect, beforeEach, jest } = require('@jest/globals');

// Prevent transitive infrastructure deps from loading (Mongo, Sentry, etc.)
jest.mock('../../../../config', () => ({}));
jest.mock('../../../../utils/mongoDatabaseManager', () => ({}));
jest.mock('@sentry/node', () => ({ init: jest.fn(), captureException: jest.fn() }));

// Mock @opentelemetry/api before requiring the module under test
jest.mock('@opentelemetry/api', () => ({
    trace: {
        getActiveSpan: jest.fn()
    }
}));

// Mock the common logging module
jest.mock('../../../../operations/common/logging', () => ({
    logInfo: jest.fn(),
    logDebug: jest.fn(),
    logError: jest.fn()
}));

// Mock heavy infrastructure classes so assertTypeEquals instanceof checks still work
// while avoiding actual DB / Kafka / etc. setup.
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
const { logInfo } = require('../../../../operations/common/logging');
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
 * Build a minimal ParsedArgs-like stub. We avoid loading the real ParsedArgs
 * to keep the test isolated from query-parsing infrastructure.
 */
function buildParsedArgs() {
    // Mimic enough of ParsedArgs so assertTypeEquals passes (it uses instanceof).
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
    return parsedArgs;
}

/**
 * Build a minimal requestInfo object.
 */
function buildRequestInfo({ masterPersonIdFromJwtToken = null, isUser = false } = {}) {
    return {
        method: 'GET',
        user: 'test-user',
        scope: 'patient/*.read',
        isUser,
        userType: null,
        personIdFromJwtToken: null,
        masterPersonIdFromJwtToken,
        managingOrganizationId: null,
        requestId: 'req-test',
        userRequestId: 'user-req-test',
        host: 'localhost',
        protocol: 'https',
        actor: null
    };
}

describe('EverythingOperation.everythingBundleAsync — OTel span attribute and log', () => {
    let operation;
    let mockSpan;
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

        mockSpan = { setAttribute: jest.fn() };

        mockGraphOperation = Object.create(GraphOperation.prototype);
        mockGraphOperation.graph = jest.fn().mockResolvedValue({ entry: [] });

        mockFhirLoggingManager = Object.create(FhirLoggingManager.prototype);
        mockFhirLoggingManager.logOperationSuccessAsync = jest.fn().mockResolvedValue(undefined);
        mockFhirLoggingManager.logOperationFailureAsync = jest.fn().mockResolvedValue(undefined);

        mockScopesValidator = Object.create(ScopesValidator.prototype);
        mockScopesValidator.verifyHasValidScopesAsync = jest.fn().mockResolvedValue(undefined);

        mockConfigManager = Object.create(ConfigManager.prototype);
        mockConfigManager.useAccessIndex = false;

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

    test.each([
        ['person-test-123', true],
        [null, false],
        [undefined, false]
    ])(
        'when masterPersonIdFromJwtToken is %s: setAttribute called = %s',
        async (masterPersonIdFromJwtToken, expectAttributeSet) => {
            // GIVEN
            trace.getActiveSpan.mockReturnValue(mockSpan);
            const requestInfo = buildRequestInfo({ masterPersonIdFromJwtToken });
            const parsedArgs = buildParsedArgs();

            // WHEN
            await operation.everythingBundleAsync({
                requestInfo,
                parsedArgs,
                resourceType: 'Practitioner'
            });

            // THEN
            if (expectAttributeSet) {
                expect(mockSpan.setAttribute).toHaveBeenCalledWith(
                    'bwell.person.id',
                    masterPersonIdFromJwtToken
                );
            } else {
                expect(mockSpan.setAttribute).not.toHaveBeenCalled();
            }
        }
    );

    test('does not throw when no active span is present and person id is set', async () => {
        // GIVEN — no active span returned by OTel API
        trace.getActiveSpan.mockReturnValue(null);
        const requestInfo = buildRequestInfo({ masterPersonIdFromJwtToken: 'person-test-456' });
        const parsedArgs = buildParsedArgs();

        // WHEN / THEN — must not throw
        await expect(
            operation.everythingBundleAsync({
                requestInfo,
                parsedArgs,
                resourceType: 'Practitioner'
            })
        ).resolves.not.toThrow();
    });

    test('emits bwellFhirPersonId as a structured log field when person id is present', async () => {
        // GIVEN
        trace.getActiveSpan.mockReturnValue(mockSpan);
        const masterPersonIdFromJwtToken = 'person-test-789';
        const requestInfo = buildRequestInfo({ masterPersonIdFromJwtToken });
        const parsedArgs = buildParsedArgs();

        // WHEN
        await operation.everythingBundleAsync({
            requestInfo,
            parsedArgs,
            resourceType: 'Practitioner'
        });

        // THEN
        expect(logInfo).toHaveBeenCalledWith(
            'everything operation',
            expect.objectContaining({ bwellFhirPersonId: masterPersonIdFromJwtToken })
        );
    });

    test('does not emit person id log entry when masterPersonIdFromJwtToken is absent', async () => {
        // GIVEN
        trace.getActiveSpan.mockReturnValue(mockSpan);
        const requestInfo = buildRequestInfo({ masterPersonIdFromJwtToken: null });
        const parsedArgs = buildParsedArgs();

        // WHEN
        await operation.everythingBundleAsync({
            requestInfo,
            parsedArgs,
            resourceType: 'Practitioner'
        });

        // THEN
        expect(logInfo).not.toHaveBeenCalledWith(
            'everything operation',
            expect.anything()
        );
    });
});
