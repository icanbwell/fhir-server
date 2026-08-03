const { describe, test, expect, beforeEach, jest: jestObj } = require('@jest/globals');

// Mock dependencies
jestObj.mock('../../../../utils/uid.util', () => ({
    generateUUIDv5: jestObj.fn()
}));

jestObj.mock('../../../../utils/contentTypes', () => ({
    fhirContentTypes: {
        fhirJson: 'application/fhir+json',
        fhirJson2: 'application/json',
        ndJson: 'application/fhir+ndjson'
    }
}));

jestObj.mock('../../../../operations/common/logging', () => ({
    logError: jestObj.fn(),
    logInfo: jestObj.fn(),
    logDebug: jestObj.fn(),
    logWarn: jestObj.fn()
}));

const { BaseCacheKeyGenerator } = require('../../../../operations/common/baseCacheKeyGenerator');
const { generateUUIDv5 } = require('../../../../utils/uid.util');
const { fhirContentTypes } = require('../../../../utils/contentTypes');
const { logError } = require('../../../../operations/common/logging');

describe('BaseCacheKeyGenerator', () => {
    let generator;

    beforeEach(() => {
        jestObj.clearAllMocks();

        generator = new BaseCacheKeyGenerator();
        // Set up typical subclass properties
        generator.cacheableResponseTypes = ['application/fhir+json', 'application/json'];
        generator.invalidParamsForCache = ['_debug', '_explain'];
        generator.operation = 'search';
        generator.keyParamsforCache = ['_count', '_sort'];

        generateUUIDv5.mockImplementation((input) => `uuid5-${input}`);
    });

    describe('normalizeScopesForCaching', () => {
        test('returns empty string for null scope', () => {
            const result = generator.normalizeScopesForCaching(null);
            expect(result).toBe('');
        });

        test('returns empty string for undefined scope', () => {
            const result = generator.normalizeScopesForCaching(undefined);
            expect(result).toBe('');
        });

        test('returns empty string for empty string scope', () => {
            const result = generator.normalizeScopesForCaching('');
            expect(result).toBe('');
        });

        test('sorts scopes deterministically before hashing', () => {
            generator.normalizeScopesForCaching('patient/*.read user/*.write system/*.*');

            // Should sort alphabetically: patient/*.read, system/*.*, user/*.write
            expect(generateUUIDv5).toHaveBeenCalledWith('patient/*.read,system/*.*,user/*.write');
        });

        test('produces same result regardless of input order', () => {
            generator.normalizeScopesForCaching('b a c');
            const firstCall = generateUUIDv5.mock.calls[0][0];

            generateUUIDv5.mockClear();
            generator.normalizeScopesForCaching('c a b');
            const secondCall = generateUUIDv5.mock.calls[0][0];

            expect(firstCall).toBe(secondCall);
            expect(firstCall).toBe('a,b,c');
        });

        test('filters out empty strings from extra spaces', () => {
            generator.normalizeScopesForCaching('a  b   c');

            // Extra spaces between scopes should be filtered out
            expect(generateUUIDv5).toHaveBeenCalledWith('a,b,c');
        });

        test('returns the UUID generated from normalized scopes', () => {
            generateUUIDv5.mockReturnValue('generated-uuid-123');

            const result = generator.normalizeScopesForCaching('scope1 scope2');

            expect(result).toBe('generated-uuid-123');
        });

        test('single scope is processed correctly', () => {
            generator.normalizeScopesForCaching('patient/*.read');

            expect(generateUUIDv5).toHaveBeenCalledWith('patient/*.read');
        });
    });

    describe('isResponseTypeCacheable', () => {
        test('returns true for a cacheable response type', () => {
            const result = generator.isResponseTypeCacheable('application/fhir+json', { _format: undefined });
            expect(result).toBe(true);
        });

        test('returns false for an unknown/uncacheable response type', () => {
            const result = generator.isResponseTypeCacheable('text/plain', { _format: undefined });
            expect(result).toBe(false);
        });

        test('defaults to fhirJson when responseType is undefined', () => {
            const result = generator.isResponseTypeCacheable(undefined, { _format: undefined });
            // fhirContentTypes.fhirJson = 'application/fhir+json' which is in cacheableResponseTypes
            expect(result).toBe(true);
        });

        test('uses first element when responseType is an array', () => {
            const result = generator.isResponseTypeCacheable(
                ['application/fhir+json', 'text/plain'],
                { _format: undefined }
            );
            expect(result).toBe(true);
        });

        test('returns true if parsedArgs._format matches a cacheable type', () => {
            const result = generator.isResponseTypeCacheable('text/plain', {
                _format: 'application/fhir+json'
            });
            expect(result).toBe(true);
        });

        test('returns false when neither responseType nor _format are cacheable', () => {
            const result = generator.isResponseTypeCacheable('text/csv', {
                _format: 'application/fhir+ndjson'
            });
            // 'application/fhir+ndjson' is not in our cacheableResponseTypes
            expect(result).toBe(false);
        });
    });

    describe('generateCacheKey', () => {
        function makeParsedArgs(rawArgs = {}) {
            return {
                getRawArgs: () => rawArgs,
                _format: undefined
            };
        }

        test('returns undefined if cache-invalidating params are present', async () => {
            const parsedArgs = makeParsedArgs({ _debug: true });

            const result = await generator.generateCacheKey({
                id: 'patient-1',
                isPersonId: false,
                parsedArgs,
                scope: 'patient/*.read'
            });

            expect(result).toBeUndefined();
        });

        test('does not invalidate if cache-invalidating param value is false', async () => {
            const parsedArgs = makeParsedArgs({ _debug: false });

            const result = await generator.generateCacheKey({
                id: 'patient-1',
                isPersonId: false,
                parsedArgs,
                scope: 'patient/*.read'
            });

            expect(result).toBeDefined();
            expect(result).toContain('Patient:patient-1');
        });

        test('invalidates for non-boolean truthy invalidating param', async () => {
            const parsedArgs = makeParsedArgs({ _explain: 'yes' });

            const result = await generator.generateCacheKey({
                id: 'patient-1',
                isPersonId: false,
                parsedArgs,
                scope: 'patient/*.read'
            });

            expect(result).toBeUndefined();
        });

        test('builds cache key with correct structure', async () => {
            const parsedArgs = makeParsedArgs({});
            generateUUIDv5.mockReturnValue('scope-uuid');

            const result = await generator.generateCacheKey({
                id: 'patient-1',
                isPersonId: false,
                parsedArgs,
                scope: 'patient/*.read'
            });

            expect(result).toContain('Patient:patient-1');
            expect(result).toContain(':search');
            expect(result).toContain(':Scopes:scope-uuid');
        });

        test('includes Generation component when getGenerationForId returns a value', async () => {
            const parsedArgs = makeParsedArgs({});
            generator.getGenerationForId = jestObj.fn().mockResolvedValue(42);

            const result = await generator.generateCacheKey({
                id: 'patient-1',
                isPersonId: false,
                parsedArgs,
                scope: 'scope1'
            });

            expect(result).toContain(':Generation:42');
        });

        test('does not include Generation when getGenerationForId returns undefined', async () => {
            const parsedArgs = makeParsedArgs({});
            generator.getGenerationForId = jestObj.fn().mockResolvedValue(undefined);

            const result = await generator.generateCacheKey({
                id: 'patient-1',
                isPersonId: false,
                parsedArgs,
                scope: 'scope1'
            });

            expect(result).not.toContain(':Generation:');
        });

        test('returns undefined when getGenerationForId throws an error', async () => {
            const parsedArgs = makeParsedArgs({});
            generator.getGenerationForId = jestObj.fn().mockRejectedValue(new Error('DB connection failed'));

            const result = await generator.generateCacheKey({
                id: 'patient-1',
                isPersonId: false,
                parsedArgs,
                scope: 'scope1'
            });

            expect(result).toBeUndefined();
            expect(logError).toHaveBeenCalledWith(
                'Error fetching generation for cache key',
                expect.objectContaining({ id: 'patient-1', isPersonId: false })
            );
        });

        test('includes Param component when keyParamsforCache params are present in rawArgs', async () => {
            const parsedArgs = makeParsedArgs({ _count: '10', _sort: 'date' });
            generateUUIDv5.mockImplementation((input) => `uuid5-${input}`);

            const result = await generator.generateCacheKey({
                id: 'patient-1',
                isPersonId: false,
                parsedArgs,
                scope: 'scope1'
            });

            expect(result).toContain(':Param:');
            // generateUUIDv5 should be called with JSON of params
            expect(generateUUIDv5).toHaveBeenCalledWith(
                expect.stringContaining('_count')
            );
        });

        test('does not include Param component when no keyParamsforCache are in rawArgs', async () => {
            const parsedArgs = makeParsedArgs({ _other: 'value' });

            const result = await generator.generateCacheKey({
                id: 'patient-1',
                isPersonId: false,
                parsedArgs,
                scope: 'scope1'
            });

            expect(result).not.toContain(':Param:');
        });

        test('sorts array values for keyParamsforCache deterministically', async () => {
            const parsedArgs = makeParsedArgs({ _sort: ['date', 'alpha', 'beta'] });
            generateUUIDv5.mockImplementation((input) => `uuid5-${input}`);

            const result = await generator.generateCacheKey({
                id: 'patient-1',
                isPersonId: false,
                parsedArgs,
                scope: 'scope1'
            });

            // The array should be sorted before being used in the key
            const paramCall = generateUUIDv5.mock.calls.find(c => c[0].includes('_sort'));
            expect(paramCall).toBeDefined();
            const parsed = JSON.parse(paramCall[0]);
            expect(parsed._sort).toBe('alpha,beta,date');
        });

        test('uses ClientPerson prefix for isPersonId=true', async () => {
            const parsedArgs = makeParsedArgs({});

            const result = await generator.generateCacheKey({
                id: 'person-1',
                isPersonId: true,
                parsedArgs,
                scope: 'scope1'
            });

            expect(result).toContain('ClientPerson:person-1');
            expect(result).not.toContain('Patient:person-1');
        });

        test('handles empty scope in cache key', async () => {
            const parsedArgs = makeParsedArgs({});

            const result = await generator.generateCacheKey({
                id: 'patient-1',
                isPersonId: false,
                parsedArgs,
                scope: ''
            });

            // Empty scope should produce ':Scopes:' (normalizeScopesForCaching returns '')
            expect(result).toContain(':Scopes:');
        });

        test('skips null/undefined param values from keyParamsforCache', async () => {
            const parsedArgs = makeParsedArgs({ _count: null, _sort: undefined });

            const result = await generator.generateCacheKey({
                id: 'patient-1',
                isPersonId: false,
                parsedArgs,
                scope: 'scope1'
            });

            // Should not include Param because values are null/undefined
            expect(result).not.toContain(':Param:');
        });
    });

    describe('generateIdComponent', () => {
        test('returns "ClientPerson:{id}" when isPersonId is true', () => {
            const result = generator.generateIdComponent({ id: 'person-abc', isPersonId: true });
            expect(result).toBe('ClientPerson:person-abc');
        });

        test('returns "Patient:{id}" when isPersonId is false', () => {
            const result = generator.generateIdComponent({ id: 'patient-xyz', isPersonId: false });
            expect(result).toBe('Patient:patient-xyz');
        });

        test('returns "Patient:{id}" when isPersonId is undefined/falsy', () => {
            const result = generator.generateIdComponent({ id: 'some-id', isPersonId: undefined });
            expect(result).toBe('Patient:some-id');
        });
    });

    describe('getGenerationForId', () => {
        test('returns undefined by default (subclass hook)', async () => {
            const result = await generator.getGenerationForId({ id: 'test-id', isPersonId: false });
            expect(result).toBeUndefined();
        });
    });
});
