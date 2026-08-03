'use strict';

/**
 * Security tests for PatientEverythingCacheKeyGenerator — PROA consent cache invalidation.
 *
 * These tests MUST FAIL against the current implementation to prove the following
 * HIPAA-violating vulnerabilities exist:
 *
 * 1. getGenerationForId() is not implemented — stale PROA PHI served from Redis for
 *    up to 600s after consent revocation.
 * 2. No mechanism to trigger cache invalidation on consent state change.
 * 3. PROA-specific access codes are not factored into the cache key, meaning requests
 *    with different consent scopes may share a cache entry.
 * 4. _type parameter is not included in keyParamsforCache or invalidParamsForCache,
 *    allowing resource-type cross-contamination in cached responses.
 */
const { describe, test, expect, beforeEach, jest: jestGlobal } = require('@jest/globals');

jestGlobal.mock('../../../../operations/common/logging', () => ({
    logInfo: jestGlobal.fn(),
    logDebug: jestGlobal.fn(),
    logError: jestGlobal.fn()
}));

const { PatientEverythingCacheKeyGenerator } = require('../../../../operations/everything/patientEverythingCachekeyGenerator');

describe('PatientEverythingCacheKeyGenerator — PROA Consent Security', () => {
    let generator;

    beforeEach(() => {
        generator = new PatientEverythingCacheKeyGenerator();
    });

    describe('INC-331: getGenerationForId must return a number for cache invalidation', () => {
        test('getGenerationForId returns a generation number (not undefined) to enable consent-aware invalidation', async () => {
            // The SummaryCacheKeyGenerator properly implements getGenerationForId() to
            // return a numeric generation counter from Redis. When consent is revoked,
            // the generation is incremented, which changes the cache key and forces a
            // fresh query instead of serving stale PHI.
            //
            // PatientEverythingCacheKeyGenerator inherits the base class stub that
            // always returns undefined. This means the `:Generation:X` segment is
            // NEVER appended to the cache key, so consent revocation has NO effect
            // on cache validity. Stale PROA-consented PHI continues to be served
            // for the full Redis TTL (600 seconds).
            const generation = await generator.getGenerationForId({
                id: 'patient-abc-123',
                isPersonId: true
            });

            // ASSERTION: generation tracking must be active (returns a number).
            // EXPECTED TO FAIL: current implementation returns undefined.
            expect(generation).not.toBeUndefined();
            expect(typeof generation).toBe('number');
        });
    });

    describe('INC-331: Consent revocation must trigger cache key change', () => {
        test('generator must accept a redisManager to track generation changes on consent revocation', () => {
            // SummaryCacheKeyGenerator accepts a redisManager in its constructor
            // and uses it to read/increment the generation counter. This allows the
            // consent-revocation event handler to increment the generation, which
            // immediately invalidates all cached $everything responses for that patient.
            //
            // PatientEverythingCacheKeyGenerator has NO constructor parameter for
            // redisManager and NO mechanism to detect consent state changes.
            // This means there is literally no code path that can invalidate the
            // cache when a PROA consent is revoked — a direct HIPAA violation.
            const hasRedisManager = generator.redisManager !== undefined;

            // ASSERTION: generator must have a redisManager for generation tracking.
            // EXPECTED TO FAIL: current constructor sets no redisManager property.
            expect(hasRedisManager).toBe(true);
        });
    });

    describe('INC-331: PROA access codes must differentiate cache keys', () => {
        test('cache key differs when PROA-specific access scopes change', async () => {
            // When a patient has PROA consent, the $everything response includes PHI
            // from the PROA data source (e.g., health plan claims). The scope string
            // passed to generateCacheKey includes access codes like "patient/*.read access/proa".
            //
            // If a consent is later revoked, the scope for subsequent requests should
            // NOT match the old cache key. However, since getGenerationForId returns
            // undefined for BOTH requests, the Generation segment is omitted from both
            // keys. The only differentiator is the scope hash — but if the scope string
            // is identical (same client, same patient), the same cache entry is served
            // regardless of consent status.
            //
            // The generator SHOULD include a consent-state indicator (generation) in
            // the key so that even with identical scopes, revoked consent forces a miss.
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

            // Simulate consent revocation: generation should change, causing a new key.
            // Since getGenerationForId always returns undefined, we cannot actually
            // trigger a generation increment. We verify the key includes a Generation
            // segment that would vary on consent state change.
            expect(keyBeforeRevocation).toBeDefined();
            expect(keyBeforeRevocation).toMatch(/Generation:\d+/);
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
            // Currently, _type is in NEITHER invalidParamsForCache NOR keyParamsforCache,
            // so both requests get the SAME cache key and the second request may receive
            // cached Observations when it asked for Conditions.
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

            // ASSERTION: different _type values must produce different cache keys.
            // EXPECTED TO FAIL: both will be identical because _type is ignored.
            expect(keyForObservation).not.toEqual(keyForCondition);
        });
    });
});
