'use strict';

/**
 * Regression tests for docs/resource-authorization.md §10 "Delegated actor access".
 *
 * A delegated actor (`userType: 'delegatedUser'`) is a RelatedPerson-like caller acting on behalf
 * of a Person via a JWT `act` claim. §10 documents six composed steps; this file verifies each one
 * against the REAL implementations (never a stand-in class):
 *
 *   1. Detection            - AuthService.processForDelegatedActor / processUserInfo
 *   2. Operation restriction - DelegatedAccessManager.verifyAccess
 *   3. Pre-query consent gate - DelegatedAccessScopeManager.isAccessAllowedAsync
 *   4. Query path            - not re-tested here (covered by the patient-scope routing tests)
 *   5. Sensitive-data exclusion - DataSharingManager.updateQueryForDelegatedAccessSensitiveData,
 *      composed with the REAL DelegatedAccessRulesManager (only its DB/tracer collaborators are
 *      stubbed) so the request-scoped `actor._filteringRules` cache is exercised for real.
 *   6. Content-level filtering - CompositionSectionFilterEnrichmentProvider, composed with the REAL
 *      filterCompositionSensitiveSections util, proving the documented (imperfect) current
 *      behavior that an `unclassified`-only section is NOT stripped here (unlike step 5's
 *      query-level filter, which always excludes `unclassified`).
 *
 * IMPORTANT: `src/tests/unit/operations/security/delegatedAccessScopeManager.test.js` is excluded
 * from CI (see jest.config.js testPathIgnorePatterns) because it asserts against an inline
 * stand-in class instead of the real DelegatedAccessScopeManager, producing a fabricated
 * "CRITICAL: null actor fail-open" finding that does NOT reproduce against the real code. The
 * real `isAccessAllowedAsync` already returns `false` for a null/undefined actor or personId -
 * this file proves that against the real class instead of repeating the fabrication.
 */
const { describe, test, it, expect, beforeEach, jest } = require('@jest/globals');

const { AuthService } = require('../../../strategies/authService');
const { ConfigManager } = require('../../../utils/configManager');
const { WellKnownConfigurationManager } = require('../../../utils/wellKnownConfiguration/wellKnownConfigurationManager');

const { DelegatedAccessManager } = require('../../../utils/delegatedAccessManager');
const { DelegatedAccessScopeManager } = require('../../../operations/security/delegatedAccessScopeManager');
const { DelegatedAccessRulesManager } = require('../../../utils/delegatedAccessRulesManager');
const { DataSharingManager } = require('../../../operations/search/dataSharingManager');
const { CompositionSectionFilterEnrichmentProvider } = require('../../../enrich/providers/compositionSectionFilterEnrichmentProvider');

const { DatabaseQueryFactory } = require('../../../dataLayer/databaseQueryFactory');
const { CustomTracer } = require('../../../utils/customTracer');
const { PatientFilterManager } = require('../../../fhir/patientFilterManager');
const { SearchQueryBuilder } = require('../../../operations/search/searchQueryBuilder');
const { BwellPersonFinder } = require('../../../utils/bwellPersonFinder');
const { ProaConsentManager } = require('../../../operations/search/proaConsentManager');
const { CmsConsentManager } = require('../../../operations/search/cmsConsentManager');
const { RequestSpecificCache } = require('../../../utils/requestSpecificCache');

const { AUTH_USER_TYPES, DELEGATED_ACCESS, SENSITIVE_CATEGORY } = require('../../../constants');

jest.mock('../../../operations/common/logging', () => ({
    logError: jest.fn(),
    logInfo: jest.fn(),
    logDebug: jest.fn(),
    logWarn: jest.fn()
}));

// Only the DB-shaped internals of DelegatedAccessRulesManager.fetchConsentResourcesAsync are
// stubbed out (query-filter builders); the caching, parsing, and error-handling logic under test
// is the real class, exercised end-to-end through DataSharingManager.
jest.mock('../../../operations/query/filters/searchFilterFromReference', () => ({
    SearchFilterFromReference: {
        buildFilter: jest.fn().mockReturnValue([{ 'patient._uuid': { $in: ['person.person-1'] } }])
    }
}));
jest.mock('../../../utils/referenceParser', () => ({
    ReferenceParser: {
        parseReference: jest.fn().mockReturnValue({
            id: 'rp-1',
            resourceType: 'RelatedPerson',
            sourceAssigningAuthority: undefined
        })
    }
}));
jest.mock('../../../utils/querybuilder.util', () => ({
    dateQueryBuilder: jest.fn().mockReturnValue({ $lte: '2026-01-01' })
}));

function createMockInstance (ClassType) {
    return Object.create(ClassType.prototype);
}

function createCursor (consentResources) {
    return {
        maxTimeMS: jest.fn(),
        hint: jest.fn(),
        getCollection: jest.fn().mockReturnValue('Consent_4_0_0'),
        explainAsync: jest.fn().mockResolvedValue([]),
        toArrayAsync: jest.fn().mockResolvedValue(consentResources)
    };
}

describe('Resource Authorization §10 — Delegated actor access', () => {
    // ------------------------------------------------------------------
    // 1. Detection - AuthService.processForDelegatedActor / processUserInfo
    // ------------------------------------------------------------------
    describe('1. Detection (AuthService)', () => {
        /** @type {AuthService} */
        let authService;
        let mockConfigManager;
        let mockWellKnownConfigManager;

        beforeEach(() => {
            AuthService.jwksCache = undefined;
            AuthService.userInfoCache = undefined;

            mockConfigManager = createMockInstance(ConfigManager);
            Object.defineProperty(mockConfigManager, 'externalRequestTimeoutSec', { get: () => 30, configurable: true });
            Object.defineProperty(mockConfigManager, 'externalAuthJwksUrls', { get: () => [], configurable: true });
            Object.defineProperty(mockConfigManager, 'externalAuthWellKnownUrls', { get: () => [], configurable: true });
            Object.defineProperty(mockConfigManager, 'authCustomScope', { get: () => [], configurable: true });
            Object.defineProperty(mockConfigManager, 'authCustomGroup', { get: () => [], configurable: true });
            Object.defineProperty(mockConfigManager, 'authCustomUserName', { get: () => [], configurable: true });
            Object.defineProperty(mockConfigManager, 'authCustomSubject', { get: () => [], configurable: true });
            Object.defineProperty(mockConfigManager, 'authCustomClientId', { get: () => [], configurable: true });
            Object.defineProperty(mockConfigManager, 'authRemoveScopePrefixes', { get: () => [], configurable: true });
            Object.defineProperty(mockConfigManager, 'authCidCheckIssuer', { get: () => '', configurable: true });
            Object.defineProperty(mockConfigManager, 'authCidCheckClientIds', { get: () => [], configurable: true });
            Object.defineProperty(mockConfigManager, 'enableDelegatedAccessDetection', { get: () => true, configurable: true });

            mockWellKnownConfigManager = createMockInstance(WellKnownConfigurationManager);
            mockWellKnownConfigManager.getJwksUrlsAsync = jest.fn().mockResolvedValue([]);
            mockWellKnownConfigManager.getWellKnownConfigurationForIssuerAsync = jest.fn().mockResolvedValue(null);

            authService = new AuthService({
                configManager: mockConfigManager,
                wellKnownConfigurationManager: mockWellKnownConfigManager
            });
        });

        const requiredJwtFields = {
            clientFhirPersonId: 'person-1',
            clientFhirPatientId: 'patient-1',
            bwellFhirPersonId: 'bwell-person-1',
            bwellFhirPatientId: 'bwell-patient-1',
            sub: 'subject-1'
        };

        test('a valid RelatedPerson `act` claim sets userType=delegatedUser and actor on the context', () => {
            const done = jest.fn();
            authService.processUserInfo({
                username: 'testuser',
                subject: 'sub1',
                isUser: true,
                jwt_payload: {
                    ...requiredJwtFields,
                    act: { reference: 'RelatedPerson/rp-1', sub: 'delegate-sub' }
                },
                done,
                client_id: 'client1',
                scope: 'patient/Patient.read'
            });

            expect(done).toHaveBeenCalledWith(
                null,
                expect.any(Object),
                expect.objectContaining({
                    context: expect.objectContaining({
                        userType: AUTH_USER_TYPES.delegatedUser,
                        actor: { reference: 'RelatedPerson/rp-1', sub: 'delegate-sub' }
                    })
                })
            );
        });

        test('`entitlements`, when present, become `purposeOfUse` on the context', () => {
            const done = jest.fn();
            authService.processUserInfo({
                username: 'testuser',
                subject: 'sub1',
                isUser: true,
                jwt_payload: {
                    ...requiredJwtFields,
                    act: { reference: 'RelatedPerson/rp-1', sub: 'delegate-sub' },
                    entitlements: ['treatment']
                },
                done,
                client_id: 'client1',
                scope: 'patient/Patient.read'
            });

            expect(done).toHaveBeenCalledWith(
                null,
                expect.any(Object),
                expect.objectContaining({
                    context: expect.objectContaining({ purposeOfUse: ['treatment'] })
                })
            );
        });

        test('gated by configManager.enableDelegatedAccessDetection: `act` claim is ignored entirely when the flag is off', () => {
            Object.defineProperty(mockConfigManager, 'enableDelegatedAccessDetection', { get: () => false, configurable: true });
            AuthService.jwksCache = undefined;
            AuthService.userInfoCache = undefined;
            authService = new AuthService({
                configManager: mockConfigManager,
                wellKnownConfigurationManager: mockWellKnownConfigManager
            });

            const done = jest.fn();
            authService.processUserInfo({
                username: 'testuser',
                subject: 'sub1',
                isUser: true,
                jwt_payload: {
                    ...requiredJwtFields,
                    act: { reference: 'RelatedPerson/rp-1', sub: 'delegate-sub' },
                    entitlements: ['treatment']
                },
                done,
                client_id: 'client1',
                scope: 'patient/Patient.read'
            });

            const context = done.mock.calls[0][2].context;
            expect(context.userType).toBeUndefined();
            expect(context.actor).toBeUndefined();
            expect(context.purposeOfUse).toBeUndefined();
        });

        test('processForDelegatedActor rejects a non-RelatedPerson act reference', () => {
            const result = authService.processForDelegatedActor({
                jwt_payload: { act: { reference: 'Patient/123', sub: 'delegate-sub' } }
            });
            expect(result.failure).toBe(true);
            expect(result.actor).toBeNull();
        });

        test('processForDelegatedActor extracts only reference and sub from a valid act claim', () => {
            const result = authService.processForDelegatedActor({
                jwt_payload: {
                    act: { reference: 'RelatedPerson/rp-1', sub: 'delegate-sub', extraField: 'ignored' }
                }
            });
            expect(result.failure).toBe(false);
            expect(result.actor).toEqual({ reference: 'RelatedPerson/rp-1', sub: 'delegate-sub' });
        });
    });

    // ------------------------------------------------------------------
    // 2. Operation restriction - DelegatedAccessManager.verifyAccess
    // ------------------------------------------------------------------
    describe('2. Operation restriction (DelegatedAccessManager)', () => {
        /** @type {DelegatedAccessManager} */
        let delegatedAccessManager;

        beforeEach(() => {
            delegatedAccessManager = new DelegatedAccessManager();
        });

        test.each(DELEGATED_ACCESS.ALLOWED_OPERATIONS)('allows read operation "%s" for a delegated user', (operation) => {
            expect(() => delegatedAccessManager.verifyAccess({
                requestInfo: { userType: AUTH_USER_TYPES.delegatedUser },
                resourceType: 'Patient',
                operation
            })).not.toThrow();
        });

        test.each(['create', 'update', 'delete', 'patch', 'merge', 'mutation'])('throws a 403 Forbidden for write operation "%s"', (operation) => {
            // Note: ForbiddenError's own base-class constructor (ServerError) calls
            // Object.setPrototypeOf(this, ServerError.prototype), which resets the prototype
            // chain so `instanceof ForbiddenError` does NOT hold for its own instances - hence
            // asserting on statusCode/message here rather than `toThrow(ForbiddenError)`.
            expect(() => delegatedAccessManager.verifyAccess({
                requestInfo: { userType: AUTH_USER_TYPES.delegatedUser },
                resourceType: 'Patient',
                operation
            })).toThrow(new RegExp(`does not have access to ${operation.toUpperCase()} method`));

            try {
                delegatedAccessManager.verifyAccess({
                    requestInfo: { userType: AUTH_USER_TYPES.delegatedUser },
                    resourceType: 'Patient',
                    operation
                });
                throw new Error('expected verifyAccess to throw');
            } catch (e) {
                expect(e.statusCode).toBe(403);
            }
        });

        test('a non-delegated user is unaffected (can perform any operation as far as this manager is concerned)', () => {
            expect(() => delegatedAccessManager.verifyAccess({
                requestInfo: { userType: 'user' },
                resourceType: 'Patient',
                operation: 'create'
            })).not.toThrow();
        });
    });

    // ------------------------------------------------------------------
    // 3. Pre-query consent gate - DelegatedAccessScopeManager.isAccessAllowedAsync
    // ------------------------------------------------------------------
    describe('3. Pre-query consent gate (DelegatedAccessScopeManager)', () => {
        /** @type {DelegatedAccessScopeManager} */
        let delegatedAccessScopeManager;
        /** @type {{ hasValidConsentAsync: jest.Mock }} */
        let mockDelegatedAccessRulesManager;

        beforeEach(() => {
            // The collaborator (DelegatedAccessRulesManager) is mocked here per the assignment -
            // DelegatedAccessScopeManager is the class under test, not its collaborator.
            mockDelegatedAccessRulesManager = createMockInstance(DelegatedAccessRulesManager);
            mockDelegatedAccessRulesManager.hasValidConsentAsync = jest.fn();

            delegatedAccessScopeManager = new DelegatedAccessScopeManager({
                delegatedAccessRulesManager: mockDelegatedAccessRulesManager
            });
        });

        test('null actor is denied WITHOUT calling into the rules manager (fails closed, not open)', async () => {
            const result = await delegatedAccessScopeManager.isAccessAllowedAsync({
                actor: null,
                personIdFromJwtToken: 'person-1'
            });
            expect(result).toBe(false);
            expect(mockDelegatedAccessRulesManager.hasValidConsentAsync).not.toHaveBeenCalled();
        });

        test('undefined actor is denied without throwing', async () => {
            const result = await delegatedAccessScopeManager.isAccessAllowedAsync({
                actor: undefined,
                personIdFromJwtToken: 'person-1'
            });
            expect(result).toBe(false);
        });

        test('null personIdFromJwtToken is denied WITHOUT calling into the rules manager', async () => {
            const result = await delegatedAccessScopeManager.isAccessAllowedAsync({
                actor: { reference: 'RelatedPerson/rp-1' },
                personIdFromJwtToken: null
            });
            expect(result).toBe(false);
            expect(mockDelegatedAccessRulesManager.hasValidConsentAsync).not.toHaveBeenCalled();
        });

        test('empty-string personIdFromJwtToken is denied (falsy check)', async () => {
            const result = await delegatedAccessScopeManager.isAccessAllowedAsync({
                actor: { reference: 'RelatedPerson/rp-1' },
                personIdFromJwtToken: ''
            });
            expect(result).toBe(false);
        });

        test('valid actor + personId with consent found delegates to hasValidConsentAsync and returns true', async () => {
            mockDelegatedAccessRulesManager.hasValidConsentAsync.mockResolvedValue(true);
            const actor = { reference: 'RelatedPerson/rp-1' };

            const result = await delegatedAccessScopeManager.isAccessAllowedAsync({
                actor,
                personIdFromJwtToken: 'person-1'
            });

            expect(result).toBe(true);
            expect(mockDelegatedAccessRulesManager.hasValidConsentAsync).toHaveBeenCalledWith({
                actor,
                personIdFromJwtToken: 'person-1'
            });
        });

        test('valid actor + personId with NO consent found returns false', async () => {
            mockDelegatedAccessRulesManager.hasValidConsentAsync.mockResolvedValue(false);

            const result = await delegatedAccessScopeManager.isAccessAllowedAsync({
                actor: { reference: 'RelatedPerson/rp-1' },
                personIdFromJwtToken: 'person-1'
            });

            expect(result).toBe(false);
        });
    });

    // ------------------------------------------------------------------
    // 5. Sensitive-data exclusion - DataSharingManager.updateQueryForDelegatedAccessSensitiveData
    //    composed with the REAL DelegatedAccessRulesManager.
    // ------------------------------------------------------------------
    describe('5. Sensitive-data exclusion (DataSharingManager + real DelegatedAccessRulesManager)', () => {
        /** @type {DataSharingManager} */
        let dataSharingManager;
        /** @type {DelegatedAccessRulesManager} */
        let delegatedAccessRulesManager;
        let mockDatabaseQueryFactory;
        let mockConfigManagerForRules;

        beforeEach(() => {
            mockConfigManagerForRules = createMockInstance(ConfigManager);
            Object.defineProperty(mockConfigManagerForRules, 'mongoTimeout', { get: () => 30000, configurable: true });
            Object.defineProperty(mockConfigManagerForRules, 'dataSharingAccessCodes', { get: () => ['dataSharingAccess'], configurable: true });

            mockDatabaseQueryFactory = createMockInstance(DatabaseQueryFactory);
            mockDatabaseQueryFactory.createQuery = jest.fn();

            const realCustomTracer = createMockInstance(CustomTracer);
            realCustomTracer.trace = jest.fn(({ func }) => func());

            delegatedAccessRulesManager = new DelegatedAccessRulesManager({
                configManager: mockConfigManagerForRules,
                databaseQueryFactory: mockDatabaseQueryFactory,
                customTracer: realCustomTracer
            });

            // Only `delegatedAccessRulesManager` is exercised by updateQueryForDelegatedAccessSensitiveData;
            // the other DataSharingManager dependencies are unused by that method but are still
            // required to be real-typed instances by the constructor's assertTypeEquals checks.
            dataSharingManager = new DataSharingManager({
                databaseQueryFactory: mockDatabaseQueryFactory,
                configManager: mockConfigManagerForRules,
                patientFilterManager: createMockInstance(PatientFilterManager),
                searchQueryBuilder: createMockInstance(SearchQueryBuilder),
                bwellPersonFinder: createMockInstance(BwellPersonFinder),
                proaConsentManager: createMockInstance(ProaConsentManager),
                cmsConsentManager: createMockInstance(CmsConsentManager),
                requestSpecificCache: new RequestSpecificCache(),
                delegatedAccessRulesManager
            });
        });

        test('no active Consent found -> returns the impossible query { _uuid: "__invalid__" }', async () => {
            mockDatabaseQueryFactory.createQuery.mockReturnValue({
                findAsync: jest.fn().mockResolvedValue(createCursor([]))
            });

            const result = await dataSharingManager.updateQueryForDelegatedAccessSensitiveData({
                base_version: '4_0_0',
                query: { resourceType: 'Observation' },
                actor: { reference: 'RelatedPerson/rp-1' },
                personIdFromJwtToken: 'person-1'
            });

            expect(result).toEqual({ _uuid: '__invalid__' });
        });

        test('MORE THAN ONE active Consent found -> throws ForbiddenError (ambiguous, fails closed)', async () => {
            mockDatabaseQueryFactory.createQuery.mockReturnValue({
                findAsync: jest.fn().mockResolvedValue(createCursor([
                    { _uuid: 'consent-1', meta: { versionId: '1' } },
                    { _uuid: 'consent-2', meta: { versionId: '1' } }
                ]))
            });

            await expect(
                dataSharingManager.updateQueryForDelegatedAccessSensitiveData({
                    base_version: '4_0_0',
                    query: { resourceType: 'Observation' },
                    actor: { reference: 'RelatedPerson/rp-1' },
                    personIdFromJwtToken: 'person-1'
                })
            ).rejects.toThrow(/ambiguous permissions/);
        });

        test('a single Consent with deny provisions excludes those sensitivity-category codes PLUS unclassified', async () => {
            mockDatabaseQueryFactory.createQuery.mockReturnValue({
                findAsync: jest.fn().mockResolvedValue(createCursor([{
                    _uuid: 'consent-1',
                    meta: { versionId: '1' },
                    provision: {
                        period: { start: '2024-01-01' },
                        provision: [
                            {
                                type: 'deny',
                                securityLabel: [
                                    { system: SENSITIVE_CATEGORY.SYSTEM, code: 'mental-health' },
                                    { system: SENSITIVE_CATEGORY.SYSTEM, code: 'substance-abuse' }
                                ]
                            }
                        ]
                    }
                }]))
            });

            const result = await dataSharingManager.updateQueryForDelegatedAccessSensitiveData({
                base_version: '4_0_0',
                query: { resourceType: 'Observation' },
                actor: { reference: 'RelatedPerson/rp-1' },
                personIdFromJwtToken: 'person-1'
            });

            const excludedCodes = result.$and[1]['meta.security'].$not.$elemMatch.code.$in;
            expect(excludedCodes).toEqual(expect.arrayContaining(['mental-health', 'substance-abuse', 'unclassified']));
            expect(result.$and[1]['meta.security'].$not.$elemMatch.system).toBe(SENSITIVE_CATEGORY.SYSTEM);
        });

        test('`unclassified` is ALWAYS in the exclusion set, even when the Consent denies nothing', async () => {
            mockDatabaseQueryFactory.createQuery.mockReturnValue({
                findAsync: jest.fn().mockResolvedValue(createCursor([{
                    _uuid: 'consent-1',
                    meta: { versionId: '1' },
                    provision: { period: { start: '2024-01-01' } }
                    // no nested `provision.provision` deny entries at all
                }]))
            });

            const result = await dataSharingManager.updateQueryForDelegatedAccessSensitiveData({
                base_version: '4_0_0',
                query: { resourceType: 'Observation' },
                actor: { reference: 'RelatedPerson/rp-1' },
                personIdFromJwtToken: 'person-1'
            });

            // MongoQuerySimplifier collapses a single-element `{ $in: ['unclassified'] }` down to
            // the bare value `'unclassified'` (semantically equivalent for Mongo), so with no
            // Consent-denied categories the exclusion code is the plain string, not a $in array.
            const excludedCode = result.$and[1]['meta.security'].$not.$elemMatch.code;
            expect(excludedCode).toBe('unclassified');
        });

        test('getFilteringRulesAsync is cached on the request-scoped actor object: a second call with the SAME actor does not re-fetch', async () => {
            const cursor = createCursor([{
                _uuid: 'consent-1',
                meta: { versionId: '1' },
                provision: { period: { start: '2024-01-01' } }
            }]);
            const findAsync = jest.fn().mockResolvedValue(cursor);
            mockDatabaseQueryFactory.createQuery.mockReturnValue({ findAsync });

            const actor = { reference: 'RelatedPerson/rp-1' };

            await dataSharingManager.updateQueryForDelegatedAccessSensitiveData({
                base_version: '4_0_0',
                query: { resourceType: 'Observation' },
                actor,
                personIdFromJwtToken: 'person-1'
            });
            expect(findAsync).toHaveBeenCalledTimes(1);
            expect(actor._filteringRules).toBeDefined();

            // Second call, same actor instance -> DelegatedAccessRulesManager.getFilteringRulesAsync
            // must read actor._filteringRules instead of hitting the database again.
            await dataSharingManager.updateQueryForDelegatedAccessSensitiveData({
                base_version: '4_0_0',
                query: { resourceType: 'Observation' },
                actor,
                personIdFromJwtToken: 'person-1'
            });
            expect(findAsync).toHaveBeenCalledTimes(1);
            expect(mockDatabaseQueryFactory.createQuery).toHaveBeenCalledTimes(1);
        });

        test('a fresh actor object (new request) DOES re-fetch, even with the same personIdFromJwtToken', async () => {
            const findAsync = jest.fn()
                .mockResolvedValueOnce(createCursor([{ _uuid: 'consent-1', meta: { versionId: '1' }, provision: { period: { start: '2024-01-01' } } }]))
                .mockResolvedValueOnce(createCursor([{ _uuid: 'consent-1', meta: { versionId: '1' }, provision: { period: { start: '2024-01-01' } } }]));
            mockDatabaseQueryFactory.createQuery.mockReturnValue({ findAsync });

            await dataSharingManager.updateQueryForDelegatedAccessSensitiveData({
                base_version: '4_0_0',
                query: { resourceType: 'Observation' },
                actor: { reference: 'RelatedPerson/rp-1' },
                personIdFromJwtToken: 'person-1'
            });
            await dataSharingManager.updateQueryForDelegatedAccessSensitiveData({
                base_version: '4_0_0',
                query: { resourceType: 'Observation' },
                actor: { reference: 'RelatedPerson/rp-1' }, // new object, request-scoped cache does not persist
                personIdFromJwtToken: 'person-1'
            });

            expect(findAsync).toHaveBeenCalledTimes(2);
        });
    });

    // ------------------------------------------------------------------
    // 6. Content-level filtering (enrichment-time) - CompositionSectionFilterEnrichmentProvider,
    //    composed with the REAL filterCompositionSensitiveSections util.
    // ------------------------------------------------------------------
    describe('6. Content-level filtering (CompositionSectionFilterEnrichmentProvider + real filter util)', () => {
        /** @type {CompositionSectionFilterEnrichmentProvider} */
        let provider;
        let mockConfigManager;

        beforeEach(() => {
            mockConfigManager = createMockInstance(ConfigManager);
            Object.defineProperty(mockConfigManager, 'enableDelegatedAccessDetection', { get: () => true, configurable: true });
            provider = new CompositionSectionFilterEnrichmentProvider({ configManager: mockConfigManager });
        });

        function buildComposition ({ id, section }) {
            return { resourceType: 'Composition', _uuid: id, section };
        }

        test('strips a section tagged with a Consent-denied sensitivity-category code', async () => {
            const composition = buildComposition({
                id: 'comp-1',
                section: [
                    {
                        id: 'denied-section',
                        code: { coding: [{ system: SENSITIVE_CATEGORY.SYSTEM, code: 'mental-health' }] }
                    },
                    {
                        id: 'kept-section',
                        code: { coding: [{ system: SENSITIVE_CATEGORY.SYSTEM, code: 'general' }] }
                    }
                ]
            });
            const enrichmentContext = {
                userType: AUTH_USER_TYPES.delegatedUser,
                actor: { _filteringRules: { deniedSensitiveCategories: ['mental-health'] } }
            };

            const [result] = await provider.enrichAsync({
                resources: [composition],
                parsedArgs: {},
                enrichmentContext
            });

            expect(result.section).toHaveLength(1);
            expect(result.section[0].id).toBe('kept-section');
        });

        test('KNOWN INCONSISTENCY (doc §12 Low): a section tagged ONLY `unclassified`, with no matching Consent-denied category, is NOT stripped', async () => {
            // Unlike step 5's query-level exclusion (which always ANDs in the hardcoded
            // `unclassified` code regardless of what the Consent denies), this enrichment-time
            // filter only strips sections matching a code the grantor's Consent explicitly denied.
            // This test documents/proves that CURRENT behavior - it is not asserting the "correct"
            // or ideal behavior, which per the doc would require also folding in `unclassified`.
            const composition = buildComposition({
                id: 'comp-2',
                section: [
                    {
                        id: 'unclassified-section',
                        code: { coding: [{ system: SENSITIVE_CATEGORY.SYSTEM, code: SENSITIVE_CATEGORY.UNCLASSIFIED_CODE }] }
                    }
                ]
            });
            const enrichmentContext = {
                userType: AUTH_USER_TYPES.delegatedUser,
                // Consent denies some unrelated category - NOT unclassified.
                actor: { _filteringRules: { deniedSensitiveCategories: ['mental-health'] } }
            };

            const [result] = await provider.enrichAsync({
                resources: [composition],
                parsedArgs: {},
                enrichmentContext
            });

            expect(result.section).toHaveLength(1);
            expect(result.section[0].id).toBe('unclassified-section');
        });

        test('KNOWN INCONSISTENCY: unclassified-only section survives even when the Consent denies NOTHING at all', async () => {
            const composition = buildComposition({
                id: 'comp-3',
                section: [
                    {
                        id: 'unclassified-section',
                        code: { coding: [{ system: SENSITIVE_CATEGORY.SYSTEM, code: SENSITIVE_CATEGORY.UNCLASSIFIED_CODE }] }
                    }
                ]
            });
            const enrichmentContext = {
                userType: AUTH_USER_TYPES.delegatedUser,
                actor: { _filteringRules: { deniedSensitiveCategories: [] } }
            };

            const [result] = await provider.enrichAsync({
                resources: [composition],
                parsedArgs: {},
                enrichmentContext
            });

            expect(result.section).toHaveLength(1);
        });

        test('recurses into `contained` resources, stripping denied sections there too', async () => {
            const containedComposition = buildComposition({
                id: 'contained-comp',
                section: [
                    {
                        id: 'contained-denied',
                        code: { coding: [{ system: SENSITIVE_CATEGORY.SYSTEM, code: 'mental-health' }] }
                    }
                ]
            });
            const parentComposition = {
                ...buildComposition({
                    id: 'parent-comp',
                    section: [
                        { id: 'parent-kept', code: { coding: [{ system: SENSITIVE_CATEGORY.SYSTEM, code: 'general' }] } }
                    ]
                }),
                contained: [containedComposition]
            };
            const enrichmentContext = {
                userType: AUTH_USER_TYPES.delegatedUser,
                actor: { _filteringRules: { deniedSensitiveCategories: ['mental-health'] } }
            };

            const [result] = await provider.enrichAsync({
                resources: [parentComposition],
                parsedArgs: {},
                enrichmentContext
            });

            expect(result.section).toHaveLength(1);
            expect(result.contained[0].section).toBeUndefined();
        });

        test('does nothing when enableDelegatedAccessDetection is false, even for a delegatedUser with denied categories', async () => {
            Object.defineProperty(mockConfigManager, 'enableDelegatedAccessDetection', { get: () => false, configurable: true });
            const composition = buildComposition({
                id: 'comp-4',
                section: [{ id: 's1', code: { coding: [{ system: SENSITIVE_CATEGORY.SYSTEM, code: 'mental-health' }] } }]
            });
            const enrichmentContext = {
                userType: AUTH_USER_TYPES.delegatedUser,
                actor: { _filteringRules: { deniedSensitiveCategories: ['mental-health'] } }
            };

            const [result] = await provider.enrichAsync({
                resources: [composition],
                parsedArgs: {},
                enrichmentContext
            });

            expect(result.section).toHaveLength(1);
        });

        test('does nothing for a non-delegated userType', async () => {
            const composition = buildComposition({
                id: 'comp-5',
                section: [{ id: 's1', code: { coding: [{ system: SENSITIVE_CATEGORY.SYSTEM, code: 'mental-health' }] } }]
            });
            const enrichmentContext = {
                userType: 'user',
                actor: { _filteringRules: { deniedSensitiveCategories: ['mental-health'] } }
            };

            const [result] = await provider.enrichAsync({
                resources: [composition],
                parsedArgs: {},
                enrichmentContext
            });

            expect(result.section).toHaveLength(1);
        });
    });
});
