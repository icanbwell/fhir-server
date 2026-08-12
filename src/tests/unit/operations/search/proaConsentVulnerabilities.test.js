'use strict';

/**
 * Security Tests: PROA Consent Vulnerabilities
 *
 * These tests assert CORRECT behavior that the current code does NOT implement.
 * They will FAIL on the buggy code, demonstrating each vulnerability.
 *
 * Vulnerabilities covered:
 * 1. ProaConsentManager does not check provision.period.end (expired consent still grants access)
 * 2. CmsConsentManager does not check provision.period.end (expired consent still grants access)
 * 3. DataSharingManager caches allowedPatientIds without keying on securityTags
 * 4. $everything cache not invalidated on consent revocation (no generation tracking)
 * 5. No automatic cache invalidation when Consent resource status changes
 */

const { describe, beforeEach, afterEach, it, expect, jest } = require('@jest/globals');

// --- Vulnerability 1 & 2: ProaConsentManager and CmsConsentManager ignore provision.period ---

const { ProaConsentManager } = require('../../../../operations/search/proaConsentManager');
const { CmsConsentManager } = require('../../../../operations/search/cmsConsentManager');
const { DatabaseQueryFactory } = require('../../../../dataLayer/databaseQueryFactory');
const { ConfigManager } = require('../../../../utils/configManager');

jest.mock('../../../../operations/common/logging', () => ({
    logError: jest.fn(),
    logInfo: jest.fn(),
    logDebug: jest.fn()
}));

jest.mock('../../../../operations/common/systemEventLogging', () => ({
    logTraceSystemEventAsync: jest.fn(),
    logSystemEventAsync: jest.fn()
}));

// --- Vulnerability 5: auto-mock BwellPersonFinder so ConsentCacheInvalidationHandler's
// best-effort Person lookup can be exercised without a real DatabaseQueryFactory/DB.
jest.mock('../../../../utils/bwellPersonFinder');

describe('VULNERABILITY 1: ProaConsentManager does not enforce consent period expiry', () => {
    /**
     * FILE: src/operations/search/proaConsentManager.js
     * LINES: 34-57 (getConsentResources query)
     *
     * VULNERABILITY: The Mongo query in getConsentResources only checks:
     *   { status: 'active' } and { 'provision.type': 'permit' }
     * It does NOT check provision.period.end against the current date.
     *
     * EXPLOITATION: A consent with provision.period.end = "2025-01-01" (past)
     * that hasn't been manually set to 'inactive' still grants PROA data access.
     * An attacker or misconfigured system that fails to update the status field
     * allows continued access to PHI after consent has expired.
     *
     * SEVERITY: HIGH - PHI exposure beyond authorized consent period
     *
     * CORRECT BEHAVIOR: The query MUST include a condition that
     * provision.period.end is either in the future or does not exist.
     */

    let proaConsentManager;
    let mockDatabaseQueryFactory;
    let mockConfigManager;
    let capturedQuery;

    beforeEach(() => {
        capturedQuery = null;
        mockDatabaseQueryFactory = Object.create(DatabaseQueryFactory.prototype);
        mockConfigManager = Object.create(ConfigManager.prototype);
        Object.defineProperty(mockConfigManager, 'getDataSharingConsentCodes', {
            get: () => ['dataSharing'],
            configurable: true
        });

        proaConsentManager = new ProaConsentManager({
            databaseQueryFactory: mockDatabaseQueryFactory,
            configManager: mockConfigManager
        });

        // Capture the query that is sent to the database
        const mockCursor = {
            hint: jest.fn().mockReturnThis(),
            sort: jest.fn().mockReturnThis(),
            toArrayAsync: jest.fn().mockResolvedValue([])
        };

        mockDatabaseQueryFactory.createQuery = jest.fn().mockReturnValue({
            findAsync: jest.fn().mockImplementation(({ query }) => {
                capturedQuery = query;
                return Promise.resolve(mockCursor);
            })
        });
    });

    it('getConsentResources query MUST filter out expired consents (provision.period.end in the past)', async () => {
        await proaConsentManager.getConsentResources({
            ownerTags: ['client-abc'],
            patientIds: ['Patient/patient-uuid-1']
        });

        // The query must include a filter on provision.period.end
        const queryString = JSON.stringify(capturedQuery);

        // CORRECT BEHAVIOR: query should contain a condition that checks
        // provision.period.end >= current date OR provision.period.end does not exist
        expect(queryString).toContain('provision.period.end');
    });

    it('getConsentResources query MUST filter out consents that have not yet started', async () => {
        await proaConsentManager.getConsentResources({
            ownerTags: ['client-abc'],
            patientIds: ['Patient/patient-uuid-1']
        });

        const queryString = JSON.stringify(capturedQuery);

        // CORRECT BEHAVIOR: query should contain a condition that checks
        // provision.period.start <= current date OR provision.period.start does not exist
        expect(queryString).toContain('provision.period.start');
    });
});


describe('VULNERABILITY 2: CmsConsentManager does not enforce consent period expiry', () => {
    /**
     * FILE: src/operations/search/cmsConsentManager.js
     * LINES: 30-44 (getConsentResources query)
     *
     * VULNERABILITY: Same as Vulnerability 1 but for CMS data sharing.
     * The Mongo query only checks { status: 'active' } and { 'provision.type': 'permit' }.
     * It does NOT check provision.period.end or provision.period.start.
     *
     * EXPLOITATION: A CMS consent with an expired provision period still grants access
     * to linked patient data if the status field was never updated to 'inactive'.
     *
     * SEVERITY: HIGH - PHI exposure beyond authorized CMS consent period
     *
     * CORRECT BEHAVIOR: The query MUST include provision.period bounds checking.
     */

    let cmsConsentManager;
    let mockDatabaseQueryFactory;
    let capturedQuery;

    beforeEach(() => {
        capturedQuery = null;
        mockDatabaseQueryFactory = Object.create(DatabaseQueryFactory.prototype);

        cmsConsentManager = new CmsConsentManager({
            databaseQueryFactory: mockDatabaseQueryFactory
        });

        const mockCursor = {
            hint: jest.fn().mockReturnThis(),
            toArrayAsync: jest.fn().mockResolvedValue([])
        };

        mockDatabaseQueryFactory.createQuery = jest.fn().mockReturnValue({
            findAsync: jest.fn().mockImplementation(({ query }) => {
                capturedQuery = query;
                return Promise.resolve(mockCursor);
            })
        });
    });

    it('getConsentResources query MUST filter out expired CMS consents', async () => {
        await cmsConsentManager.getConsentResources([
            'Patient/person.proxy-person-uuid-1'
        ]);

        const queryString = JSON.stringify(capturedQuery);

        // CORRECT BEHAVIOR: query should contain provision.period.end check
        expect(queryString).toContain('provision.period.end');
    });

    it('getConsentResources query MUST filter out CMS consents that have not started', async () => {
        await cmsConsentManager.getConsentResources([
            'Patient/person.proxy-person-uuid-1'
        ]);

        const queryString = JSON.stringify(capturedQuery);

        // CORRECT BEHAVIOR: query should contain provision.period.start check
        expect(queryString).toContain('provision.period.start');
    });
});


describe('VULNERABILITY 3: DataSharingManager caches allowedPatientIds ignoring securityTags', () => {
    /**
     * FILE: src/operations/search/dataSharingManager.js
     * LINES: 196-211 (allowedPatientIds caching)
     *
     * VULNERABILITY: Within a single $everything request (same requestId),
     * allowedPatientIds is cached by the requestId alone. If the same
     * requestId is used to call updateQueryConsideringDataSharing multiple
     * times with DIFFERENT securityTags, the second call reuses allowedPatientIds
     * from the first call's security context.
     *
     * EXPLOITATION: In a $everything request, the first resource type query
     * may use securityTags=['client-A'] and get allowedPatientIds for that client.
     * If subsequent queries for other resource types somehow use different
     * securityTags, they will inherit client-A's consent results, potentially
     * exposing data that should not be visible under the new security context.
     *
     * SEVERITY: MEDIUM - Cross-client consent contamination within single request
     *
     * CORRECT BEHAVIOR: The cache key for allowedPatientIds MUST include
     * securityTags as a discriminator, or the cache must be invalidated when
     * securityTags change.
     */

    const { DataSharingManager } = require('../../../../operations/search/dataSharingManager');
    const { PatientFilterManager } = require('../../../../fhir/patientFilterManager');
    const { SearchQueryBuilder } = require('../../../../operations/search/searchQueryBuilder');
    const { BwellPersonFinder } = require('../../../../utils/bwellPersonFinder');
    const { RequestSpecificCache } = require('../../../../utils/requestSpecificCache');
    const { DelegatedAccessRulesManager } = require('../../../../utils/delegatedAccessRulesManager');
    const { ParsedArgs } = require('../../../../operations/query/parsedArgs');
    const httpContext = require('express-http-context');

    jest.mock('express-http-context', () => ({
        set: jest.fn(),
        get: jest.fn()
    }));

    let dataSharingManager;
    let requestSpecificCache;
    let mockProaConsentManager;
    let mockConfigManager;
    let mockSearchQueryBuilder;

    beforeEach(() => {
        const mockDatabaseQueryFactory = Object.create(DatabaseQueryFactory.prototype);
        mockConfigManager = Object.create(ConfigManager.prototype);
        Object.defineProperty(mockConfigManager, 'enableConsentedProaDataAccess', { value: true, writable: true, configurable: true });
        Object.defineProperty(mockConfigManager, 'getConsentConnectionTypesList', { value: ['proa'], writable: true, configurable: true });

        const mockPatientFilterManager = Object.create(PatientFilterManager.prototype);
        mockPatientFilterManager.isPatientRelatedResource = jest.fn().mockReturnValue(true);

        mockSearchQueryBuilder = Object.create(SearchQueryBuilder.prototype);
        mockSearchQueryBuilder.buildSearchQueryBasedOnVersion = jest.fn().mockReturnValue({
            query: { 'subject._uuid': 'Patient/patient-uuid-1' }
        });

        const mockBwellPersonFinder = Object.create(BwellPersonFinder.prototype);
        mockProaConsentManager = Object.create(ProaConsentManager.prototype);
        const mockCmsConsentManager = Object.create(CmsConsentManager.prototype);
        requestSpecificCache = new RequestSpecificCache();
        const mockDelegatedAccessRulesManager = Object.create(DelegatedAccessRulesManager.prototype);

        dataSharingManager = new DataSharingManager({
            databaseQueryFactory: mockDatabaseQueryFactory,
            configManager: mockConfigManager,
            patientFilterManager: mockPatientFilterManager,
            searchQueryBuilder: mockSearchQueryBuilder,
            bwellPersonFinder: mockBwellPersonFinder,
            proaConsentManager: mockProaConsentManager,
            cmsConsentManager: mockCmsConsentManager,
            requestSpecificCache,
            delegatedAccessRulesManager: mockDelegatedAccessRulesManager
        });
    });

    it('allowedPatientIds cache MUST be keyed on securityTags so different tags get fresh consent check', async () => {
        const requestId = 'request-cross-security';

        // Pre-populate the patient-level cache (simulating first resource type query)
        const cacheMap = requestSpecificCache.getMap({ requestId, name: 'dataSharingManager' });
        cacheMap.set('patientIdToImmediatePersonUuid', { 'patient-uuid-1': ['person-uuid-1'] });
        cacheMap.set('patientsList', [{
            id: 'p1', _sourceId: 'p1', _uuid: 'patient-uuid-1',
            meta: { security: [{ system: 'https://www.icanbwell.com/connectionType', code: 'proa' }] }
        }]);
        cacheMap.set('personToLinkedPatientsMap', new Map([['person-uuid-1', ['Patient/patient-uuid-1']]]));

        // First call with securityTags=['client-A'] - patient HAS consent for client-A
        mockProaConsentManager.getPatientIdsWithConsent = jest.fn()
            .mockResolvedValueOnce(new Set(['patient-uuid-1'])) // client-A: has consent
            .mockResolvedValueOnce(new Set()); // client-B: NO consent

        const mockParsedArgs = Object.create(ParsedArgs.prototype);
        mockParsedArgs.parsedArgItems = [{
            propertyObj: { target: ['Patient'] },
            references: [{ resourceType: 'Patient', id: 'patient-uuid-1' }],
            queryParameter: 'patient',
            queryParameterValue: {
                values: ['Patient/patient-uuid-1'],
                operator: '$or',
                regenerateValueFromValues: jest.fn().mockReturnValue('Patient/patient-uuid-1')
            },
            modifiers: []
        }];
        mockParsedArgs.clone = jest.fn().mockReturnValue(mockParsedArgs);
        mockParsedArgs.base_version = '4_0_0';

        // Call 1: securityTags=['client-A'] -> consent exists -> allowedPatientIds cached
        await dataSharingManager.updateQueryConsideringDataSharing({
            base_version: '4_0_0',
            resourceType: 'Observation',
            parsedArgs: mockParsedArgs,
            securityTags: ['client-A'],
            query: { access: 'A' },
            useHistoryTable: false,
            requestId,
            isUser: false,
            allowConsentedProaDataAccess: true
        });

        // Call 2: securityTags=['client-B'] -> NO consent should exist
        const result2 = await dataSharingManager.updateQueryConsideringDataSharing({
            base_version: '4_0_0',
            resourceType: 'Condition',
            parsedArgs: mockParsedArgs,
            securityTags: ['client-B'],
            query: { access: 'B' },
            useHistoryTable: false,
            requestId,
            isUser: false,
            allowConsentedProaDataAccess: true
        });

        // CORRECT BEHAVIOR: getPatientIdsWithConsent should be called TWICE
        // (once per distinct securityTags value) because consent is owner-scoped.
        // Currently it's called only once and the cached result is reused for client-B.
        expect(mockProaConsentManager.getPatientIdsWithConsent).toHaveBeenCalledTimes(2);

        // CORRECT BEHAVIOR: result2 should NOT include consented data query
        // because client-B has no consent. The result should be just the original query.
        expect(result2).toEqual({ access: 'B' });
    });
});


describe('VULNERABILITY 4: $everything cache key has no generation tracking for consent changes', () => {
    /**
     * FILE: src/operations/everything/patientEverythingCachekeyGenerator.js
     *
     * FIXED (DCON: fix Everything-cache Consent invalidation): PatientEverythingCacheKeyGenerator
     * now implements getGenerationForId, mirroring SummaryCacheKeyGenerator but supporting both
     * Patient:<id> and ClientPerson:<id> forms (Everything's cache legitimately keys on either,
     * depending on whether the request went through the direct-patient or proxy-Person path).
     * The Generation segment it returns is what allows ConsentCacheInvalidationHandler
     * (see VULNERABILITY 5 below) to bust the cache on a Consent write.
     *
     * These tests now verify that fixed behavior directly, using a real RedisManager backed by
     * an in-memory fake redisClient (no real Redis server needed).
     */

    const { PatientEverythingCacheKeyGenerator } = require('../../../../operations/everything/patientEverythingCachekeyGenerator');
    const { RedisManager } = require('../../../../utils/redisManager');

    /**
     * Builds a real RedisManager backed by an in-memory fake redisClient.
     * @returns {RedisManager}
     */
    function createFakeRedisManager() {
        const store = new Map();
        return new RedisManager({
            redisClient: {
                connectAsync: jest.fn().mockResolvedValue(undefined),
                get: jest.fn(async (key) => (store.has(key) ? String(store.get(key)) : null)),
                incr: jest.fn(async (key) => {
                    const next = (store.get(key) || 0) + 1;
                    store.set(key, next);
                    return next;
                })
            }
        });
    }

    it('getGenerationForId MUST return a non-undefined generation for person IDs', async () => {
        const generator = new PatientEverythingCacheKeyGenerator({ redisManager: createFakeRedisManager() });

        const generation = await generator.getGenerationForId({
            id: 'person-uuid-abc',
            isPersonId: true
        });

        expect(generation).not.toBeUndefined();
        expect(typeof generation).toBe('number');
    });

    it('getGenerationForId MUST return a non-undefined generation for patient IDs', async () => {
        const generator = new PatientEverythingCacheKeyGenerator({ redisManager: createFakeRedisManager() });

        const generation = await generator.getGenerationForId({
            id: 'patient-uuid-xyz',
            isPersonId: false
        });

        expect(generation).not.toBeUndefined();
        expect(typeof generation).toBe('number');
    });

    it('cache key MUST differ before and after consent revocation', async () => {
        const redisManager = createFakeRedisManager();
        const generator = new PatientEverythingCacheKeyGenerator({ redisManager });

        // Simulate a ParsedArgs-like object for cache key generation
        const mockParsedArgs = {
            getRawArgs: () => ({ id: 'patient-1', base_version: '4_0_0' }),
            _format: undefined
        };

        const key1 = await generator.generateCacheKey({
            id: 'patient-uuid-1',
            isPersonId: false,
            parsedArgs: mockParsedArgs,
            scope: 'patient/*.read'
        });

        expect(key1).toBeDefined();
        expect(key1).toMatch(/Generation:\d+/);

        // Simulate what ConsentCacheInvalidationHandler does on consent revocation: bump
        // the generation counter for this patient. The next generated key must differ.
        await redisManager.incrementGenerationAsync('Patient:patient-uuid-1:Everything:Generation');

        const key2 = await generator.generateCacheKey({
            id: 'patient-uuid-1',
            isPersonId: false,
            parsedArgs: mockParsedArgs,
            scope: 'patient/*.read'
        });

        expect(key2).not.toEqual(key1);
    });
});


describe('VULNERABILITY 5: No automatic cache invalidation when Consent status changes', () => {
    /**
     * FILE (original vulnerability write-up): src/utils/fhirCacheKeyManager.js,
     *       src/routeHandlers/admin.js (admin-only /admin/invalidateCache endpoint)
     *
     * VULNERABILITY: Cache invalidation for $everything responses only happened via the
     * admin endpoint (/admin/invalidateCache). There was NO automatic hook in the FHIR
     * write pipeline that invalidated $everything caches when a Consent resource was
     * created, updated, or deleted.
     *
     * FIXED (DCON: fix Everything-cache Consent invalidation): a new post-save handler,
     * ConsentCacheInvalidationHandler (src/dataLayer/postSaveHandlers/handlers/consentCacheInvalidationHandler.js),
     * is registered in the postSaveProcessor handler list (src/createContainer.js), which
     * runs on every create/update/merge/patch/remove for every resource type. On a Consent
     * write it resolves the patient uuid from Consent.patient and calls
     * redisManager.incrementGenerationAsync('Patient:<uuid>:Everything:Generation'). Because
     * PatientEverythingCacheKeyGenerator.getGenerationForId (VULNERABILITY 4 above) folds
     * that counter into the cache key, the bump causes the next $everything cache-key
     * computation for that patient to differ from any key computed before the Consent
     * write - i.e. the old cached entry becomes unreachable and a fresh query runs.
     *
     * NOTE ON TEST DESIGN: the original version of this test asserted a
     * `FhirCacheKeyManager.invalidateCacheForConsentChange` method. That was aspirational
     * wording written before the fix's design was settled - it does not match the actual
     * implementation, which deliberately reuses the existing-but-previously-unwired
     * generation-counter pattern (shared with SummaryCacheKeyGenerator) via a post-save
     * handler, rather than adding a new method to FhirCacheKeyManager. These tests assert
     * the real behavior ("a Consent write causes future $everything cache lookups for that
     * patient to miss/regenerate") against the actual implementation instead of forcing a
     * same-named method that was never built onto FhirCacheKeyManager.
     */

    const { ConsentCacheInvalidationHandler } = require('../../../../dataLayer/postSaveHandlers/handlers/consentCacheInvalidationHandler');
    const { PatientEverythingCacheKeyGenerator } = require('../../../../operations/everything/patientEverythingCachekeyGenerator');
    const { RedisManager } = require('../../../../utils/redisManager');
    const { BwellPersonFinder } = require('../../../../utils/bwellPersonFinder');

    /**
     * Builds a real RedisManager backed by an in-memory fake redisClient.
     * @returns {RedisManager}
     */
    function createFakeRedisManager() {
        const store = new Map();
        return new RedisManager({
            redisClient: {
                connectAsync: jest.fn().mockResolvedValue(undefined),
                get: jest.fn(async (key) => (store.has(key) ? String(store.get(key)) : null)),
                incr: jest.fn(async (key) => {
                    const next = (store.get(key) || 0) + 1;
                    store.set(key, next);
                    return next;
                })
            }
        });
    }

    /**
     * BwellPersonFinder is auto-mocked (jest.mock at top of file) so this can be
     * instantiated without a real DatabaseQueryFactory/DB. Its lookup of Person(s)
     * immediately linked to a patient is stubbed to return no links by default.
     * @returns {BwellPersonFinder}
     */
    function createFakeBwellPersonFinder() {
        const finder = new BwellPersonFinder();
        finder.getImmediatePersonIdsOfPatientsAsync = jest.fn().mockResolvedValue({
            patientReferenceToPersonUuid: {}
        });
        return finder;
    }

    it('ConsentCacheInvalidationHandler MUST bump the Everything-cache generation for the consent patient on a Consent write', async () => {
        const redisManager = createFakeRedisManager();
        const handler = new ConsentCacheInvalidationHandler({
            redisManager,
            bwellPersonFinder: createFakeBwellPersonFinder()
        });

        // A revoked consent resource, as it would appear post-save (patient reference
        // enriched with _uuid, mirroring referenceGlobalIdHandler's output shape)
        const revokedConsent = {
            resourceType: 'Consent',
            id: 'consent-uuid-1',
            status: 'rejected',
            patient: {
                reference: 'Patient/3fa85f64-5717-4562-b3fc-2c963f66afa6',
                _uuid: 'Patient/3fa85f64-5717-4562-b3fc-2c963f66afa6'
            }
        };

        await handler.afterSaveAsync({
            requestId: 'req-1',
            eventType: 'U',
            resourceType: 'Consent',
            doc: revokedConsent
        });

        const generationValue = await redisManager.getCacheAsync('Patient:3fa85f64-5717-4562-b3fc-2c963f66afa6:Everything:Generation');
        expect(Number(generationValue)).toBe(1);
    });

    it('a Consent write MUST cause the next $everything cache-key lookup for that patient to differ (cache miss/regenerate)', async () => {
        const redisManager = createFakeRedisManager();
        const handler = new ConsentCacheInvalidationHandler({
            redisManager,
            bwellPersonFinder: createFakeBwellPersonFinder()
        });
        const keyGenerator = new PatientEverythingCacheKeyGenerator({ redisManager });
        const mockParsedArgs = { getRawArgs: () => ({}), _format: undefined };

        const keyBeforeConsentWrite = await keyGenerator.generateCacheKey({
            id: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
            isPersonId: false,
            parsedArgs: mockParsedArgs,
            scope: 'patient/*.read'
        });

        await handler.afterSaveAsync({
            requestId: 'req-2',
            eventType: 'U',
            resourceType: 'Consent',
            doc: {
                resourceType: 'Consent',
                id: 'consent-uuid-2',
                status: 'rejected',
                patient: {
                    reference: 'Patient/3fa85f64-5717-4562-b3fc-2c963f66afa6',
                    _uuid: 'Patient/3fa85f64-5717-4562-b3fc-2c963f66afa6'
                }
            }
        });

        const keyAfterConsentWrite = await keyGenerator.generateCacheKey({
            id: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
            isPersonId: false,
            parsedArgs: mockParsedArgs,
            scope: 'patient/*.read'
        });

        expect(keyAfterConsentWrite).not.toEqual(keyBeforeConsentWrite);
    });
});
