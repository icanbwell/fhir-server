const { describe, test, expect, beforeEach, jest } = require('@jest/globals');

jest.mock('../../../../operations/common/logging', () => {
    const { jest: j } = require('@jest/globals');
    return { logInfo: j.fn(), logError: j.fn(), logDebug: j.fn() };
});

jest.mock('../../../../graphs/patient/summary.json', () => ({
    link: [{
        target: [
            { type: 'Observation', params: 'date=ge{Last2Years}' },
            { type: 'Condition', params: 'clinical-status=active' },
            { type: 'Patient', params: '' },
            { type: 'Composition', params: '' }
        ]
    }]
}));

jest.mock('@icanbwell/fhirpatientsummary', () => {
    const { jest: j } = require('@jest/globals');
    return {
        ComprehensiveIPSCompositionBuilder: j.fn().mockImplementation(() => ({
            readBundleAsync: j.fn().mockResolvedValue(undefined),
            buildBundleAsync: j.fn().mockResolvedValue({
                resourceType: 'Bundle',
                type: 'document',
                entry: [],
                meta: {}
            }),
            getRemainingResourcesFromCompositionBundle: j.fn().mockReturnValue([])
        })),
        TBundle: class {}
    };
});

jest.mock('../../../../utils/filterGraphResources', () => {
    const { jest: j } = require('@jest/globals');
    return { filterGraphResources: j.fn((graph) => graph) };
});

jest.mock('../../../../operations/summary/mergeBundleMetaTags', () => {
    const { jest: j } = require('@jest/globals');
    return { mergeBundleMetaTags: j.fn((bundle) => bundle) };
});

const { SummaryOperation } = require('../../../../operations/summary/summary');
const { GraphOperation } = require('../../../../operations/graph/graph');
const { ScopesValidator } = require('../../../../operations/security/scopesValidator');
const { FhirLoggingManager } = require('../../../../operations/common/fhirLoggingManager');
const { ParsedArgs } = require('../../../../operations/query/parsedArgs');
const { ConfigManager } = require('../../../../utils/configManager');
const { RedisManager } = require('../../../../utils/redisManager');
const { PostRequestProcessor } = require('../../../../utils/postRequestProcessor');
const { SummaryCacheKeyGenerator } = require('../../../../operations/summary/summaryCacheKeyGenerator');
const { SearchBundleOperation } = require('../../../../operations/search/searchBundle');
const { R4ArgsParser } = require('../../../../operations/query/r4ArgsParser');
const { EnrichmentManager } = require('../../../../enrich/enrich');
const { BaseResponseHandler } = require('../../../../utils/responseHandler/baseResponseHandler');

function createMockInstance(ClassType) {
    return Object.create(ClassType.prototype);
}

describe('SummaryOperation', () => {
    let summaryOp;
    let mocks;
    let mockParsedArgs;
    let mockResponseHandler;

    beforeEach(() => {
        mocks = {
            graphOperation: createMockInstance(GraphOperation),
            searchBundleOperation: createMockInstance(SearchBundleOperation),
            r4ArgsParser: createMockInstance(R4ArgsParser),
            fhirLoggingManager: createMockInstance(FhirLoggingManager),
            scopesValidator: createMockInstance(ScopesValidator),
            configManager: createMockInstance(ConfigManager),
            redisManager: createMockInstance(RedisManager),
            enrichmentManager: createMockInstance(EnrichmentManager),
            postRequestProcessor: createMockInstance(PostRequestProcessor),
            summaryCacheKeyGenerator: createMockInstance(SummaryCacheKeyGenerator)
        };

        mocks.scopesValidator.verifyHasValidScopesAsync = jest.fn().mockResolvedValue(undefined);
        mocks.graphOperation.graph = jest.fn().mockResolvedValue({
            resourceType: 'Bundle',
            entry: [{ resource: { resourceType: 'Patient', id: 'p1' } }],
            meta: {}
        });
        mocks.r4ArgsParser.parseArgs = jest.fn().mockReturnValue({
            headers: {},
            add: jest.fn(),
            get: jest.fn()
        });
        mocks.fhirLoggingManager.logOperationSuccessAsync = jest.fn().mockResolvedValue(undefined);
        mocks.fhirLoggingManager.logOperationFailureAsync = jest.fn().mockResolvedValue(undefined);
        mocks.redisManager.hasCacheKeyAsync = jest.fn().mockResolvedValue(false);
        mocks.redisManager.readBundleFromCacheAsync = jest.fn().mockResolvedValue(null);
        mocks.redisManager.writeBundleAsync = jest.fn().mockResolvedValue(undefined);
        mocks.redisManager.deleteKeyAsync = jest.fn().mockResolvedValue(undefined);
        mocks.postRequestProcessor.add = jest.fn();
        mocks.summaryCacheKeyGenerator.isResponseTypeCacheable = jest.fn().mockReturnValue(true);
        mocks.summaryCacheKeyGenerator.generateCacheKey = jest.fn().mockResolvedValue('cache-key-1');
        mocks.enrichmentManager.enrichBundleEntriesAsync = jest.fn(({ entries }) => Promise.resolve(entries));
        mocks.searchBundleOperation.searchBundleAsync = jest.fn().mockResolvedValue({
            resourceType: 'Bundle',
            entry: []
        });

        Object.defineProperty(mocks.configManager, 'writeToCacheForSummaryOperation', { get: () => false, configurable: true });
        Object.defineProperty(mocks.configManager, 'readFromCacheForSummaryOperation', { get: () => false, configurable: true });
        Object.defineProperty(mocks.configManager, 'serverTimeZone', { get: () => 'America/New_York', configurable: true });
        Object.defineProperty(mocks.configManager, 'summaryGeneratorOrganizationId', { get: () => 'bwell', configurable: true });
        Object.defineProperty(mocks.configManager, 'summaryGeneratorOrganizationName', { get: () => 'b.well', configurable: true });
        Object.defineProperty(mocks.configManager, 'summaryGeneratorOrganizationBaseUrl', { get: () => 'https://bwell.com', configurable: true });

        mockParsedArgs = createMockInstance(ParsedArgs);
        mockParsedArgs.base_version = '4_0_0';
        mockParsedArgs.id = ['patient-1'];
        mockParsedArgs.headers = {};
        mockParsedArgs._debug = false;
        mockParsedArgs._explain = false;
        mockParsedArgs._lastUpdated = null;
        mockParsedArgs._profile = null;
        mockParsedArgs._rewritePatientReference = null;
        mockParsedArgs._includeSummaryCompositionOnly = false;
        mockParsedArgs.resource = null;
        mockParsedArgs.getRawArgs = jest.fn().mockReturnValue({});
        mockParsedArgs.getOriginal = jest.fn().mockReturnValue(null);
        mockParsedArgs.add = jest.fn();
        mockParsedArgs.get = jest.fn();
        mockParsedArgs.remove = jest.fn();

        mockResponseHandler = createMockInstance(BaseResponseHandler);
        mockResponseHandler.sendResponseAsync = jest.fn().mockResolvedValue(undefined);

        summaryOp = new SummaryOperation(mocks);
    });

    // ========== fetchOriginalIdsFromParams ==========
    describe('fetchOriginalIdsFromParams', () => {
        test('returns empty array when no id param', () => {
            const args = createMockInstance(ParsedArgs);
            args.getOriginal = jest.fn().mockReturnValue(null);
            expect(summaryOp.fetchOriginalIdsFromParams(args)).toEqual([]);
        });

        test('returns array of ids from comma-separated value', () => {
            const args = createMockInstance(ParsedArgs);
            args.getOriginal = jest.fn().mockReturnValue({
                queryParameterValue: { value: 'id1,id2' }
            });
            expect(summaryOp.fetchOriginalIdsFromParams(args)).toEqual(['id1', 'id2']);
        });

        test('returns single id', () => {
            const args = createMockInstance(ParsedArgs);
            args.getOriginal = jest.fn().mockReturnValue({
                queryParameterValue: { value: 'id1' }
            });
            expect(summaryOp.fetchOriginalIdsFromParams(args)).toEqual(['id1']);
        });
    });

    // ========== getCacheKey ==========
    describe('getCacheKey', () => {
        test('returns undefined for delegatedUser', async () => {
            const requestInfo = { userType: 'delegatedUser', accept: 'application/json', isUser: false, personIdFromJwtToken: null };
            const args = createMockInstance(ParsedArgs);
            args.getOriginal = jest.fn().mockReturnValue({
                queryParameterValue: { value: 'person.uuid-1' }
            });
            const result = await summaryOp.getCacheKey(args, requestInfo);
            expect(result).toBeUndefined();
        });

        test('returns undefined when multiple ids', async () => {
            const requestInfo = { userType: null, accept: 'application/json', isUser: false, personIdFromJwtToken: null };
            const args = createMockInstance(ParsedArgs);
            args.getOriginal = jest.fn().mockReturnValue({
                queryParameterValue: { value: 'id1,id2' }
            });
            const result = await summaryOp.getCacheKey(args, requestInfo);
            expect(result).toBeUndefined();
        });

        test('returns undefined when id does not start with person. prefix', async () => {
            const requestInfo = { userType: null, accept: 'application/json', isUser: false, personIdFromJwtToken: null };
            const args = createMockInstance(ParsedArgs);
            args.getOriginal = jest.fn().mockReturnValue({
                queryParameterValue: { value: 'regular-id' }
            });
            const result = await summaryOp.getCacheKey(args, requestInfo);
            expect(result).toBeUndefined();
        });
    });

    // ========== summaryBundleAsync (large method) ==========
    describe('summaryBundleAsync', () => {
        test('throws for non-Patient resourceType', async () => {
            await expect(
                summaryOp.summaryBundleAsync({
                    requestInfo: { requestId: 'r1', userType: null, accept: 'application/json', scope: 'user/*.read', skipCachedData: () => false },
                    res: {},
                    parsedArgs: mockParsedArgs,
                    resourceType: 'Observation',
                    responseHandler: mockResponseHandler
                })
            ).rejects.toThrow(/not supported/);
        });

        test('calls graph operation for Patient resource type', async () => {
            await summaryOp.summaryBundleAsync({
                requestInfo: { requestId: 'r1', userType: null, accept: 'application/json', scope: 'user/*.read', skipCachedData: () => false },
                res: {},
                parsedArgs: mockParsedArgs,
                resourceType: 'Patient',
                responseHandler: mockResponseHandler
            });
            expect(mocks.graphOperation.graph).toHaveBeenCalled();
        });

        test('sends empty bundle response when no entries found', async () => {
            mocks.graphOperation.graph.mockResolvedValue({
                resourceType: 'Bundle',
                entry: [],
                meta: {}
            });
            await summaryOp.summaryBundleAsync({
                requestInfo: { requestId: 'r1', userType: null, accept: 'application/json', scope: 'user/*.read', skipCachedData: () => false },
                res: {},
                parsedArgs: mockParsedArgs,
                resourceType: 'Patient',
                responseHandler: mockResponseHandler
            });
            expect(mockResponseHandler.sendResponseAsync).toHaveBeenCalledWith(
                expect.objectContaining({ entry: [] }),
                expect.any(String)
            );
        });

        test('reads from cache when available', async () => {
            Object.defineProperty(mocks.configManager, 'writeToCacheForSummaryOperation', { get: () => true, configurable: true });
            Object.defineProperty(mocks.configManager, 'readFromCacheForSummaryOperation', { get: () => true, configurable: true });

            // Setup cache scenario - need to make getCacheKey return a key
            const cachedBundle = {
                resourceType: 'Bundle',
                entry: [{ resource: { resourceType: 'Patient', id: 'cached-p1' } }],
                meta: {}
            };
            mocks.redisManager.hasCacheKeyAsync.mockResolvedValue(true);
            mocks.redisManager.readBundleFromCacheAsync.mockResolvedValue(cachedBundle);

            // Make getCacheKey actually return something
            summaryOp.getCacheKey = jest.fn().mockResolvedValue('cache-key-1');

            const requestInfo = {
                requestId: 'r1',
                userType: null,
                accept: 'application/json',
                scope: 'user/*.read',
                skipCachedData: () => false
            };

            await summaryOp.summaryBundleAsync({
                requestInfo,
                res: {},
                parsedArgs: mockParsedArgs,
                resourceType: 'Patient',
                responseHandler: mockResponseHandler
            });

            // Should NOT call graphOperation since we read from cache
            expect(mocks.graphOperation.graph).not.toHaveBeenCalled();
        });

        test('handles _lastUpdated parameter by removing from parsedArgs and adding to graph', async () => {
            mockParsedArgs._lastUpdated = '2023-01-01';
            await summaryOp.summaryBundleAsync({
                requestInfo: { requestId: 'r1', userType: null, accept: 'application/json', scope: 'user/*.read', skipCachedData: () => false },
                res: {},
                parsedArgs: mockParsedArgs,
                resourceType: 'Patient',
                responseHandler: mockResponseHandler
            });
            // _lastUpdated should have been removed
            expect(mockParsedArgs._lastUpdated).toBeNull();
        });
    });

    // ========== summaryAsync (wrapper) ==========
    describe('summaryAsync', () => {
        test('logs failure and rethrows on error', async () => {
            mocks.scopesValidator.verifyHasValidScopesAsync.mockRejectedValue(new Error('forbidden'));
            await expect(
                summaryOp.summaryAsync({
                    requestInfo: { requestId: 'r1', userType: null, accept: 'application/json', scope: 'user/*.read', skipCachedData: () => false },
                    res: {},
                    parsedArgs: mockParsedArgs,
                    resourceType: 'Patient',
                    responseHandler: mockResponseHandler
                })
            ).rejects.toThrow('forbidden');
            expect(mocks.fhirLoggingManager.logOperationFailureAsync).toHaveBeenCalled();
        });
    });
});
