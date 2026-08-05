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
     * FILE: src/operations/everything/patientEverythingCachekeyGenerator.js (lines 1-35)
     *       src/operations/common/baseCacheKeyGenerator.js (line 130)
     *
     * VULNERABILITY: PatientEverythingCacheKeyGenerator inherits getGenerationForId
     * from BaseCacheKeyGenerator which always returns undefined. This means:
     * - Cache key is: Patient:<id>:Everything:Scopes:<scopeHash>
     * - No generation counter is included
     * - When a Consent is revoked (status changed to 'rejected'), the cache key
     *   remains identical, so stale cached PHI continues to be served
     *
     * EXPLOITATION: Patient revokes PROA consent. For the next 5 minutes (TTL=300s),
     * the $everything endpoint continues to serve the pre-revocation data including
     * all PROA-sourced resources that should now be excluded.
     *
     * SEVERITY: CRITICAL - PHI served after consent revocation for up to TTL duration
     *
     * CORRECT BEHAVIOR: getGenerationForId MUST return a generation number that
     * changes when any consent affecting this patient is modified.
     */

    const { PatientEverythingCacheKeyGenerator } = require('../../../../operations/everything/patientEverythingCachekeyGenerator');

    it('getGenerationForId MUST return a non-undefined generation for person IDs', async () => {
        const generator = new PatientEverythingCacheKeyGenerator();

        const generation = await generator.getGenerationForId({
            id: 'person-uuid-abc',
            isPersonId: true
        });

        // CORRECT: Must return a number so cache key changes when consent changes
        // Currently returns undefined, meaning consent changes don't bust the cache
        expect(generation).not.toBeUndefined();
        expect(typeof generation).toBe('number');
    });

    it('getGenerationForId MUST return a non-undefined generation for patient IDs', async () => {
        const generator = new PatientEverythingCacheKeyGenerator();

        const generation = await generator.getGenerationForId({
            id: 'patient-uuid-xyz',
            isPersonId: false
        });

        // CORRECT: Must return a number so cache key changes when consent changes
        expect(generation).not.toBeUndefined();
        expect(typeof generation).toBe('number');
    });

    it('cache key MUST differ before and after consent revocation', async () => {
        const generator = new PatientEverythingCacheKeyGenerator();

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

        // After consent revocation, generation should change.
        // Since getGenerationForId returns undefined, key1 === key2 always.
        // This test would pass only if generation tracking is implemented.
        // For now, we verify the key includes a Generation segment at all.
        expect(key1).toBeDefined();
        expect(key1).toMatch(/Generation:\d+/);
    });
});


describe('VULNERABILITY 5: No automatic cache invalidation when Consent status changes', () => {
    /**
     * FILE: src/utils/fhirCacheKeyManager.js (entire file)
     *       src/routeHandlers/admin.js (lines 453-467)
     *
     * VULNERABILITY: Cache invalidation for $everything responses only happens
     * via the admin endpoint (/admin/invalidateCache). There is NO automatic
     * hook in the FHIR write pipeline that invalidates $everything caches
     * when a Consent resource is created, updated, or deleted.
     *
     * EXPLOITATION: A patient revokes consent (PUT Consent with status='rejected').
     * The write succeeds in MongoDB. But NO code triggers cache invalidation for
     * the associated patient's $everything cache. Until the Redis TTL expires
     * (300s default), all $everything requests serve stale pre-revocation data.
     *
     * SEVERITY: CRITICAL - Systematic PHI leak window after every consent revocation
     *
     * CORRECT BEHAVIOR: When a Consent resource is written/updated, the system
     * MUST invalidate $everything caches for all patients linked to that consent.
     * This should happen synchronously before the write response is returned.
     */

    const { FhirCacheKeyManager } = require('../../../../utils/fhirCacheKeyManager');

    it('FhirCacheKeyManager MUST have a method to invalidate caches for consent-linked patients', () => {
        const mockRedisClient = {
            connectAsync: jest.fn(),
            bulkDeleteKeys: jest.fn(),
            invalidateByPrefixAsync: jest.fn(),
            getAllKeysByPrefix: jest.fn()
        };

        const manager = new FhirCacheKeyManager({ redisClient: mockRedisClient });

        // CORRECT BEHAVIOR: Should have a consent-aware invalidation method
        // that takes a Consent resource and invalidates all linked patient caches
        expect(typeof manager.invalidateCacheForConsentChange).toBe('function');
    });

    it('invalidateCacheForConsentChange MUST invalidate patient $everything cache when consent is revoked', async () => {
        const mockRedisClient = {
            connectAsync: jest.fn().mockResolvedValue(undefined),
            bulkDeleteKeys: jest.fn().mockResolvedValue(undefined),
            invalidateByPrefixAsync: jest.fn().mockResolvedValue(undefined),
            getAllKeysByPrefix: jest.fn().mockResolvedValue([])
        };

        const manager = new FhirCacheKeyManager({ redisClient: mockRedisClient });

        // A revoked consent resource
        const revokedConsent = {
            resourceType: 'Consent',
            _uuid: 'consent-uuid-1',
            status: 'rejected',
            patient: {
                _uuid: 'Patient/patient-uuid-linked'
            }
        };

        // CORRECT: This method should exist and invalidate the patient's cache
        if (typeof manager.invalidateCacheForConsentChange === 'function') {
            await manager.invalidateCacheForConsentChange({ consent: revokedConsent });

            // Should have invalidated cache for the linked patient
            expect(mockRedisClient.invalidateByPrefixAsync).toHaveBeenCalledWith(
                expect.stringContaining('Patient:patient-uuid-linked')
            );
        } else {
            // Method doesn't exist - this assertion will fail, proving the vulnerability
            expect(typeof manager.invalidateCacheForConsentChange).toBe('function');
        }
    });
});
