'use strict';

/**
 * Regression tests for PatientEverythingCacheKeyGenerator — PROA consent cache invalidation
 * (DCON: fix Everything-cache Consent invalidation).
 *
 * These tests originally asserted the fixed behavior against a not-yet-implemented
 * generation-tracking mechanism (see git history for the original "MUST FAIL" comments).
 * Now that PatientEverythingCacheKeyGenerator implements getGenerationForId() (mirroring
 * SummaryCacheKeyGenerator, but supporting both Patient:<id> and ClientPerson:<id> forms)
 * and a ConsentCacheInvalidationHandler post-save handler bumps the generation counter on
 * every Consent write, these tests verify that mechanism directly:
 *
 * 1. getGenerationForId() returns a real generation number (not undefined), so the
 *    `:Generation:X` segment is appended to the cache key.
 * 2. The generator accepts a redisManager, which is what the post-save handler's
 *    generation bump (incrementGenerationAsync) ultimately affects.
 * 3. The Generation segment is present in generated cache keys, which is what allows a
 *    Consent-triggered generation bump to change the key on the next read.
 * 4. _type is included in keyParamsforCache, so requests differing only by _type no
 *    longer share a cache entry.
 */
const { describe, test, expect, beforeEach, jest: jestGlobal } = require('@jest/globals');

jestGlobal.mock('../../../../operations/common/logging', () => ({
    logInfo: jestGlobal.fn(),
    logDebug: jestGlobal.fn(),
    logError: jestGlobal.fn()
}));

const { PatientEverythingCacheKeyGenerator } = require('../../../../operations/everything/patientEverythingCachekeyGenerator');
const { RedisManager } = require('../../../../utils/redisManager');

/**
 * Builds a real RedisManager backed by an in-memory fake redisClient, so
 * getGenerationForId()/generateCacheKey() exercise the real generation-tracking logic
 * without needing an actual Redis server.
 * @returns {RedisManager}
 */
function createFakeRedisManager() {
    const store = new Map();
    const redisClient = {
        connectAsync: jestGlobal.fn().mockResolvedValue(undefined),
        get: jestGlobal.fn(async (key) => (store.has(key) ? String(store.get(key)) : null)),
        incr: jestGlobal.fn(async (key) => {
            const next = (store.get(key) || 0) + 1;
            store.set(key, next);
            return next;
        })
    };
    return new RedisManager({ redisClient });
}

describe('PatientEverythingCacheKeyGenerator — PROA Consent Security', () => {
    let generator;

    beforeEach(() => {
        generator = new PatientEverythingCacheKeyGenerator({ redisManager: createFakeRedisManager() });
    });

    describe('INC-331: getGenerationForId must return a number for cache invalidation', () => {
        test('getGenerationForId returns a generation number (not undefined) to enable consent-aware invalidation', async () => {
            // SummaryCacheKeyGenerator returns a numeric generation counter from Redis, and
            // when the counter is incremented (e.g. by ConsentCacheInvalidationHandler), the
            // cache key changes and forces a fresh query instead of serving stale PHI.
            // PatientEverythingCacheKeyGenerator now implements the same contract.
            const generation = await generator.getGenerationForId({
                id: 'patient-abc-123',
                isPersonId: true
            });

            expect(generation).not.toBeUndefined();
            expect(typeof generation).toBe('number');
        });
    });

    describe('INC-331: Consent revocation must trigger cache key change', () => {
        test('generator must accept a redisManager to track generation changes on consent revocation', () => {
            // SummaryCacheKeyGenerator accepts a redisManager in its constructor and uses it
            // to read/increment the generation counter. PatientEverythingCacheKeyGenerator
            // now does the same, which is what allows ConsentCacheInvalidationHandler (a
            // post-save handler that fires on every Consent write) to bump the generation
            // and invalidate cached $everything responses for the affected patient/person.
            const hasRedisManager = generator.redisManager !== undefined;

            expect(hasRedisManager).toBe(true);
        });
    });

    describe('INC-331: PROA access codes must differentiate cache keys', () => {
        test('cache key includes a Generation segment that changes when the generation counter is bumped', async () => {
            // When a patient has PROA consent, the $everything response includes PHI
            // from the PROA data source (e.g., health plan claims). The scope string
            // passed to generateCacheKey includes access codes like "patient/*.read access/proa".
            //
            // The Generation segment (not the scope hash) is what forces a cache miss when
            // a Consent write bumps the generation counter for this id, even if the scope
            // string is otherwise identical across requests.
            const mockParsedArgs = {
                getRawArgs: () => ({}),
                _format: undefined
            };

            const keyBeforeRevocation = await generator.generateCacheKey({
                id: 'person-xyz',
                isPersonId: true,
                parsedArgs: mockParsedArgs,
                scope: 'patient/*.read access/proa'
            });

            expect(keyBeforeRevocation).toBeDefined();
            expect(keyBeforeRevocation).toMatch(/Generation:\d+/);

            // Simulate what ConsentCacheInvalidationHandler does on a Consent write: bump
            // the generation counter for this id. The next generated key must differ.
            await generator.redisManager.incrementGenerationAsync('ClientPerson:person-xyz:Everything:Generation');

            const keyAfterRevocation = await generator.generateCacheKey({
                id: 'person-xyz',
                isPersonId: true,
                parsedArgs: mockParsedArgs,
                scope: 'patient/*.read access/proa'
            });

            expect(keyAfterRevocation).not.toEqual(keyBeforeRevocation);
        });
    });

    describe('INC-331: _type parameter must affect cache key to prevent resource cross-contamination', () => {
        test('requests with different _type values produce different cache keys', async () => {
            // The _type parameter controls which FHIR resource types are returned
            // in the $everything Bundle. For example:
            //   GET /Patient/123/$everything?_type=Observation
            //   GET /Patient/123/$everything?_type=Condition
            //
            // These MUST produce different cache keys because they return different data.
            // _type is now in keyParamsforCache, so both requests get different cache keys.
            const mockParsedArgsWithObservation = {
                getRawArgs: () => ({ _type: 'Observation' }),
                _format: undefined
            };

            const mockParsedArgsWithCondition = {
                getRawArgs: () => ({ _type: 'Condition' }),
                _format: undefined
            };

            const keyForObservation = await generator.generateCacheKey({
                id: 'patient-456',
                isPersonId: false,
                parsedArgs: mockParsedArgsWithObservation,
                scope: 'patient/*.read'
            });

            const keyForCondition = await generator.generateCacheKey({
                id: 'patient-456',
                isPersonId: false,
                parsedArgs: mockParsedArgsWithCondition,
                scope: 'patient/*.read'
            });

            expect(keyForObservation).not.toEqual(keyForCondition);
        });
    });
});
