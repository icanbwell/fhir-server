const { describe, test, expect, jest: jestObj, beforeEach, beforeAll } = require('@jest/globals');

// Mock baseCacheKeyGenerator
jestObj.mock('../../../../operations/common/baseCacheKeyGenerator', () => {
    class BaseCacheKeyGenerator {
        constructor() {
            this.operation = '';
            this.invalidParamsForCache = [];
            this.cacheableResponseTypes = [];
        }
    }
    return { BaseCacheKeyGenerator };
});

// Mock contentTypes
jestObj.mock('../../../../utils/contentTypes', () => ({
    fhirContentTypes: {
        fhirJson: 'application/fhir+json',
        fhirJson2: 'application/json',
        fhirJson3: 'json',
        ndJson: 'application/fhir+ndjson',
        ndJson2: 'application/ndjson',
        ndJson3: 'ndjson'
    }
}));

const { PatientEverythingCacheKeyGenerator } = require('../../../../operations/everything/patientEverythingCachekeyGenerator');
const { RedisManager } = require('../../../../utils/redisManager');

/**
 * Builds a real RedisManager backed by an in-memory fake redisClient, so the
 * generator's `instanceof RedisManager` assertion is satisfied without needing a real
 * Redis server.
 * @returns {RedisManager}
 */
function createFakeRedisManager() {
    return new RedisManager({
        redisClient: {
            connectAsync: jestObj.fn().mockResolvedValue(undefined),
            get: jestObj.fn().mockResolvedValue(null),
            incr: jestObj.fn().mockResolvedValue(1)
        }
    });
}

describe('PatientEverythingCacheKeyGenerator', () => {
    let generator;

    beforeEach(() => {
        generator = new PatientEverythingCacheKeyGenerator({ redisManager: createFakeRedisManager() });
    });

    test('sets operation to Everything', () => {
        expect(generator.operation).toBe('Everything');
    });

    test('invalidParamsForCache has 12 items', () => {
        expect(generator.invalidParamsForCache).toHaveLength(12);
    });

    test('invalidParamsForCache includes _since', () => {
        expect(generator.invalidParamsForCache).toContain('_since');
    });

    test('invalidParamsForCache includes contained', () => {
        expect(generator.invalidParamsForCache).toContain('contained');
    });

    test('invalidParamsForCache includes all expected params', () => {
        const expectedParams = [
            '_since', '_includePatientLinkedOnly', '_rewritePatientReference',
            '_includeNonClinicalResources', '_debug', '_explain', '_includeHidden',
            '_includeProxyPatientLinkedOnly', '_excludeProxyPatientLinked',
            '_includePatientLinkedUuidOnly', '_includeUuidOnly', 'contained'
        ];
        expect(generator.invalidParamsForCache).toEqual(expectedParams);
    });

    test('cacheableResponseTypes includes fhirJson types', () => {
        expect(generator.cacheableResponseTypes).toContain('application/fhir+json');
        expect(generator.cacheableResponseTypes).toContain('application/json');
        expect(generator.cacheableResponseTypes).toContain('json');
    });

    test('cacheableResponseTypes includes ndJson types', () => {
        expect(generator.cacheableResponseTypes).toContain('application/fhir+ndjson');
        expect(generator.cacheableResponseTypes).toContain('application/ndjson');
        expect(generator.cacheableResponseTypes).toContain('ndjson');
    });

    test('cacheableResponseTypes has 6 items total', () => {
        expect(generator.cacheableResponseTypes).toHaveLength(6);
    });

    test('keyParamsforCache includes _type so requests with different resource-type filters do not share a cache entry', () => {
        expect(generator.keyParamsforCache).toEqual(['_type']);
    });

    test('constructor stores the provided redisManager', () => {
        expect(generator.redisManager).toBeDefined();
    });
});

/**
 * Deepening pass (unit-test-master batch H2): getGenerationForId() had zero coverage in the
 * suite above -- every prior test only asserted constructor-set properties. This method is the
 * one piece of real, overridden logic in this file, and it directly determines the Redis key
 * used for $everything's generation-based cache-busting (see the class-level doc comment and
 * BaseCacheKeyGenerator.generateCacheKey(), which prefixes every cache key with
 * `generateIdComponent({id, isPersonId})` -- the same helper getGenerationForId() uses to build
 * its own key). SECURITY FOCUS (cache-key-insufficiency pattern, see
 * patterns/cache-key-insufficiency.md): does the generation key correctly bind to the requesting
 * patient/person id, or could two different patients collide on the same Redis key?
 */
describe('PatientEverythingCacheKeyGenerator.getGenerationForId', () => {
    // getGenerationForId() calls the INHERITED this.generateIdComponent(), which the
    // module-level jest.mock('.../baseCacheKeyGenerator') above stubs out entirely (it only
    // exists to isolate the constructor-property tests above from the base class). To exercise
    // the real inherited behavior, unmock and re-require fresh for this describe block only --
    // this does not affect the class/instances already captured by the describe block above.
    let RealPatientEverythingCacheKeyGenerator;
    let RealRedisManager;

    beforeAll(() => {
        jestObj.resetModules();
        jestObj.unmock('../../../../operations/common/baseCacheKeyGenerator');
        ({
            PatientEverythingCacheKeyGenerator: RealPatientEverythingCacheKeyGenerator
        } = require('../../../../operations/everything/patientEverythingCachekeyGenerator'));
        ({ RedisManager: RealRedisManager } = require('../../../../utils/redisManager'));
    });

    /**
     * @param {{get?: Function, incr?: Function}} redisClientOverrides
     * @returns {{generator: PatientEverythingCacheKeyGenerator, redisClient: Object}}
     */
    function createGeneratorWithRedisClient (redisClientOverrides = {}) {
        const redisClient = {
            connectAsync: jestObj.fn().mockResolvedValue(undefined),
            get: jestObj.fn().mockResolvedValue(null),
            incr: jestObj.fn().mockResolvedValue(1),
            ...redisClientOverrides
        };
        const redisManager = new RealRedisManager({ redisClient });
        return {
            generator: new RealPatientEverythingCacheKeyGenerator({ redisManager }),
            redisClient
        };
    }

    test('returns the parsed integer generation when Redis already has a numeric value', async () => {
        const { generator, redisClient } = createGeneratorWithRedisClient({
            get: jestObj.fn().mockResolvedValue('5')
        });

        const generation = await generator.getGenerationForId({ id: 'patient-a', isPersonId: false });

        expect(generation).toBe(5);
        expect(redisClient.incr).not.toHaveBeenCalled();
    });

    test('a truthy-but-falsy-looking generation value of "0" is parsed and returned correctly (boundary)', async () => {
        const { generator, redisClient } = createGeneratorWithRedisClient({
            get: jestObj.fn().mockResolvedValue('0')
        });

        const generation = await generator.getGenerationForId({ id: 'patient-a', isPersonId: false });

        expect(generation).toBe(0);
        expect(redisClient.incr).not.toHaveBeenCalled();
    });

    test('throws a descriptive error when the existing Redis value is not a valid number', async () => {
        const { generator } = createGeneratorWithRedisClient({
            get: jestObj.fn().mockResolvedValue('not-a-number')
        });

        await expect(
            generator.getGenerationForId({ id: 'patient-a', isPersonId: false })
        ).rejects.toThrow(/Invalid generation value/);
    });

    test('increments and returns a fresh generation when Redis has no existing value (cache miss)', async () => {
        const { generator, redisClient } = createGeneratorWithRedisClient({
            get: jestObj.fn().mockResolvedValue(null),
            incr: jestObj.fn().mockResolvedValue(1)
        });

        const generation = await generator.getGenerationForId({ id: 'patient-a', isPersonId: false });

        expect(generation).toBe(1);
        expect(redisClient.incr).toHaveBeenCalledTimes(1);
    });

    test('reads and increments the SAME Redis key for a given id (get/incr key consistency)', async () => {
        const { generator, redisClient } = createGeneratorWithRedisClient();

        await generator.getGenerationForId({ id: 'patient-a', isPersonId: false });

        const getKey = redisClient.get.mock.calls[0][0];
        const incrKey = redisClient.incr.mock.calls[0][0];
        expect(getKey).toBe(incrKey);
        expect(getKey).toBe('Patient:patient-a:Everything:Generation');
    });

    test('SECURITY: two different patient ids never produce the same generation cache key', async () => {
        const { generator, redisClient } = createGeneratorWithRedisClient();

        await generator.getGenerationForId({ id: 'patient-a', isPersonId: false });
        await generator.getGenerationForId({ id: 'patient-b', isPersonId: false });

        const [keyForA, keyForB] = redisClient.get.mock.calls.map((call) => call[0]);
        expect(keyForA).not.toBe(keyForB);
        expect(keyForA).toContain('patient-a');
        expect(keyForB).toContain('patient-b');
    });

    test('SECURITY: the same raw id used as a proxy-Person id vs a direct Patient id must not collide', async () => {
        const { generator, redisClient } = createGeneratorWithRedisClient();

        await generator.getGenerationForId({ id: 'shared-id', isPersonId: true });
        await generator.getGenerationForId({ id: 'shared-id', isPersonId: false });

        const [personKey, patientKey] = redisClient.get.mock.calls.map((call) => call[0]);
        expect(personKey).not.toBe(patientKey);
        expect(personKey).toBe('ClientPerson:shared-id:Everything:Generation');
        expect(patientKey).toBe('Patient:shared-id:Everything:Generation');
    });

    test('the generation key is scoped to the Everything operation (would not collide with a differently-named operation on the same id)', async () => {
        const { generator, redisClient } = createGeneratorWithRedisClient();

        await generator.getGenerationForId({ id: 'patient-a', isPersonId: false });

        expect(redisClient.get.mock.calls[0][0]).toContain(':Everything:');
    });
});
