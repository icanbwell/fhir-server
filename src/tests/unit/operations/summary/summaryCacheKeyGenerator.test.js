const { describe, test, expect, jest: jestObj, beforeEach } = require('@jest/globals');

// Mock baseCacheKeyGenerator
jestObj.mock('../../../../operations/common/baseCacheKeyGenerator', () => {
    class BaseCacheKeyGenerator {
        constructor() {
            this.operation = '';
            this.invalidParamsForCache = [];
            this.cacheableResponseTypes = [];
            this.keyParamsforCache = [];
        }
        generateIdComponent({ id, isPersonId }) {
            const resourceType = isPersonId ? 'ClientPerson' : 'Patient';
            return `${resourceType}:${id}`;
        }
    }
    return { BaseCacheKeyGenerator };
});

// Mock contentTypes
jestObj.mock('../../../../utils/contentTypes', () => ({
    fhirContentTypes: {
        fhirJson: 'application/fhir+json',
        fhirJson2: 'application/json',
        fhirJson3: 'json'
    }
}));

// Mock assertType
jestObj.mock('../../../../utils/assertType', () => ({
    assertTypeEquals: jestObj.fn()
}));

// Mock RedisManager
jestObj.mock('../../../../utils/redisManager', () => {
    class RedisManager {}
    return { RedisManager };
});

const { SummaryCacheKeyGenerator } = require('../../../../operations/summary/summaryCacheKeyGenerator');

describe('SummaryCacheKeyGenerator', () => {
    let generator;
    let mockRedisManager;

    beforeEach(() => {
        mockRedisManager = {
            getCacheAsync: jestObj.fn(),
            incrementGenerationAsync: jestObj.fn()
        };
        generator = new SummaryCacheKeyGenerator({ redisManager: mockRedisManager });
    });

    test('sets operation to Summary', () => {
        expect(generator.operation).toBe('Summary');
    });

    test('sets invalidParamsForCache correctly', () => {
        expect(generator.invalidParamsForCache).toEqual([
            '_rewritePatientReference', '_debug', '_explain', '_lastUpdated'
        ]);
    });

    test('sets cacheableResponseTypes to json types only', () => {
        expect(generator.cacheableResponseTypes).toEqual([
            'application/fhir+json', 'application/json', 'json'
        ]);
    });

    test('sets keyParamsforCache correctly', () => {
        expect(generator.keyParamsforCache).toEqual(['_includeSummaryCompositionOnly']);
    });

    test('stores redisManager', () => {
        expect(generator.redisManager).toBe(mockRedisManager);
    });

    describe('getGenerationForId', () => {
        test('throws error when isPersonId is false', async () => {
            await expect(
                generator.getGenerationForId({ id: 'test-id', isPersonId: false })
            ).rejects.toThrow('SummaryCacheKeyGenerator only supports person IDs for generation tracking');
        });

        test('returns existing generation when cached value is valid', async () => {
            mockRedisManager.getCacheAsync.mockResolvedValue('5');
            const result = await generator.getGenerationForId({ id: 'person-123', isPersonId: true });
            expect(result).toBe(5);
        });

        test('throws error on invalid cached generation value', async () => {
            mockRedisManager.getCacheAsync.mockResolvedValue('not-a-number');
            await expect(
                generator.getGenerationForId({ id: 'person-123', isPersonId: true })
            ).rejects.toThrow(/Invalid generation value for key/);
        });

        test('calls incrementGenerationAsync when no cached value exists', async () => {
            mockRedisManager.getCacheAsync.mockResolvedValue(null);
            mockRedisManager.incrementGenerationAsync.mockResolvedValue(1);
            const result = await generator.getGenerationForId({ id: 'person-123', isPersonId: true });
            expect(mockRedisManager.incrementGenerationAsync).toHaveBeenCalledWith(
                'ClientPerson:person-123:Summary:Generation'
            );
            expect(result).toBe(1);
        });

        test('constructs correct key with person id', async () => {
            mockRedisManager.getCacheAsync.mockResolvedValue('3');
            await generator.getGenerationForId({ id: 'abc-456', isPersonId: true });
            expect(mockRedisManager.getCacheAsync).toHaveBeenCalledWith(
                'ClientPerson:abc-456:Summary:Generation'
            );
        });
    });
});
