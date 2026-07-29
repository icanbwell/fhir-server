/**
 * Tests for PatientEverythingCacheKeyGenerator
 * Validates cache key sufficiency for PHI isolation and consent invalidation
 */
const { describe, test, expect } = require('@jest/globals');

const { PatientEverythingCacheKeyGenerator } = require('../../../../operations/everything/patientEverythingCachekeyGenerator');

describe('PatientEverythingCacheKeyGenerator — Security', () => {
    describe('BUG: No generation tracking for cache invalidation', () => {
        test('getGenerationForId should return a valid generation number (not undefined)', async () => {
            const generator = new PatientEverythingCacheKeyGenerator();

            // SummaryCacheKeyGenerator properly implements getGenerationForId to track
            // consent/data changes. PatientEverythingCacheKeyGenerator does NOT — it
            // inherits the base class stub that returns undefined.
            //
            // This means: after consent revocation, stale PROA-consented PHI continues
            // to be served from Redis for up to TTL (600s). This violates HIPAA minimum
            // necessary principle — revoked consent MUST immediately invalidate cached data.
            const generation = await generator.getGenerationForId({
                id: 'test-person-123',
                isPersonId: true
            });

            // CORRECT: should return a number (generation counter) for cache invalidation
            // Currently returns undefined — meaning NO invalidation on consent/data changes
            expect(generation).not.toBeUndefined();
            expect(typeof generation).toBe('number');
        });
    });

    describe('BUG: invalidParamsForCache missing security-relevant params', () => {
        test('_type param should affect cache key (different resource filters = different results)', () => {
            const generator = new PatientEverythingCacheKeyGenerator();

            // _type filters which resource types are returned.
            // If NOT in invalidParamsForCache AND NOT in keyParamsforCache,
            // requests with different _type values get the same cache key.
            // Client requesting _type=Observation gets cached response from
            // _type=SubscriptionStatus request (or vice versa).
            //
            // It should either be in keyParamsforCache (included in key) or
            // invalidParamsForCache (disables caching). Currently it's in neither.
            const hasTypeInvalid = generator.invalidParamsForCache?.includes('_type');
            const hasTypeInKey = generator.keyParamsforCache?.includes('_type');

            // CORRECT: _type must either invalidate cache or be part of the key
            expect(hasTypeInvalid || hasTypeInKey).toBe(true);
        });
    });
});
