'use strict';

/**
 * Regression tests for docs/resource-authorization.md §6b "CMS partner data-sharing consent".
 *
 * Verifies, against the REAL implementations (never a stand-in class):
 *   - `SearchManager.constructQueryAsync` (src/operations/search/searchManager.js) only invokes
 *     `DataSharingManager.updateQueryConsideringCmsDataSharing` under the exact dual condition
 *     `resourceType === 'Patient' && userType === AUTH_USER_TYPES.cmsPartnerUser` — confirmed by
 *     reading the call site directly, and proven here by exercising the real SearchManager with
 *     every other resourceType/userType combination held constant.
 *   - `DataSharingManager.updateQueryConsideringCmsDataSharing`
 *     (src/operations/search/dataSharingManager.js) delegates to the REAL
 *     `CmsConsentManager.getPatientIdsWithConsent` (src/operations/search/cmsConsentManager.js) to
 *     restrict `Patient` search to consented patient uuids.
 *   - It **fails closed**: when no consent is found for any of the caller's linked patients, the
 *     query becomes the impossible filter `{ _uuid: '__invalid__' }` — it does NOT silently fall
 *     back to "no restriction". This is the important case: a bug that turned this into a no-op
 *     would silently grant a CMS partner unrestricted Patient access.
 *
 * Only true external collaborators (ConfigManager, PatientFilterManager, the Mongo-facing
 * DatabaseQueryFactory, BwellPersonFinder, logging) are mocked; SearchManager, DataSharingManager,
 * and CmsConsentManager are required from their real source paths and exercised as real instances.
 */
const { describe, test, expect, beforeEach, afterEach, jest } = require('@jest/globals');

// jest.mock calls must run before anything below requires the real source modules — this repo's
// babel/jest setup does not hoist jest.mock() above require() (see
// scopesManager.crossTenant.test.js / 06a_proaIasConsent.test.js for the same convention).
jest.mock('../../../operations/common/logging', () => ({
    logError: jest.fn(),
    logInfo: jest.fn(),
    logDebug: jest.fn(),
    logWarn: jest.fn()
}));

jest.mock('../../../operations/common/systemEventLogging', () => ({
    logTraceSystemEventAsync: jest.fn(),
    logSystemEventAsync: jest.fn()
}));

jest.mock('express-http-context', () => ({
    set: jest.fn(),
    get: jest.fn()
}));

const { SearchManager } = require('../../../operations/search/searchManager');
const { DataSharingManager } = require('../../../operations/search/dataSharingManager');
const { CmsConsentManager } = require('../../../operations/search/cmsConsentManager');
const { ProaConsentManager } = require('../../../operations/search/proaConsentManager');

const { DatabaseQueryFactory } = require('../../../dataLayer/databaseQueryFactory');
const { ResourceLocatorFactory } = require('../../../operations/common/resourceLocatorFactory');
const { SecurityTagManager } = require('../../../operations/common/securityTagManager');
const { ResourcePreparer } = require('../../../operations/common/resourcePreparer');
const { IndexHinter } = require('../../../indexes/indexHinter');
const { R4SearchQueryCreator } = require('../../../operations/query/r4');
const { ConfigManager } = require('../../../utils/configManager');
const { QueryRewriterManager } = require('../../../queryRewriters/queryRewriterManager');
const { ScopesManager } = require('../../../operations/security/scopesManager');
const { DatabaseAttachmentManager } = require('../../../dataLayer/databaseAttachmentManager');
const { Base64DataManager } = require('../../../dataLayer/base64DataManager');
const { FhirResourceWriterFactory } = require('../../../operations/streaming/resourceWriters/fhirResourceWriterFactory');
const { SearchQueryBuilder } = require('../../../operations/search/searchQueryBuilder');
const { PatientScopeManager } = require('../../../operations/security/patientScopeManager');
const { PatientQueryCreator } = require('../../../operations/common/patientQueryCreator');
const { PatientFilterManager } = require('../../../fhir/patientFilterManager');
const { BwellPersonFinder } = require('../../../utils/bwellPersonFinder');
const { RequestSpecificCache } = require('../../../utils/requestSpecificCache');
const { DelegatedAccessRulesManager } = require('../../../utils/delegatedAccessRulesManager');
const { SearchParametersManager } = require('../../../searchParameters/searchParametersManager');
const { AUTH_USER_TYPES } = require('../../../constants');

function createMockInstance (ClassType) {
    return Object.create(ClassType.prototype);
}

describe('Resource Authorization §6b — CMS partner data-sharing consent', () => {
    afterEach(() => {
        jest.clearAllMocks();
    });

    describe('SearchManager.constructQueryAsync — the exact dual condition guarding the CMS filter', () => {
        /** @type {SearchManager} */
        let searchManager;
        let mockDataSharingManager;
        let mockScopesManager;
        let mockPatientScopeManager;
        let mockPatientQueryCreator;
        let mockConfigManager;
        let mockSearchQueryBuilder;
        let mockSecurityTagManager;
        let mockQueryRewriterManager;

        beforeEach(() => {
            mockDataSharingManager = createMockInstance(DataSharingManager);
            mockDataSharingManager.updateQueryConsideringCmsDataSharing = jest.fn().mockResolvedValue({ marker: 'cms-filtered' });

            mockScopesManager = createMockInstance(ScopesManager);
            // Force every request down the patient-scope branch (§5) regardless of resourceType,
            // so the only thing distinguishing test cases below is resourceType/userType.
            mockScopesManager.isAccessAllowedByPatientScopes = jest.fn().mockReturnValue(true);

            mockPatientScopeManager = createMockInstance(PatientScopeManager);
            mockPatientScopeManager.getPatientIdsFromScopeAsync = jest.fn().mockResolvedValue(['patient-1', 'patient-2']);

            mockPatientQueryCreator = createMockInstance(PatientQueryCreator);
            mockPatientQueryCreator.getQueryWithPatientFilter = jest.fn().mockReturnValue({ patientScoped: true });

            mockConfigManager = createMockInstance(ConfigManager);
            Object.defineProperty(mockConfigManager, 'doNotRequirePersonOrPatientIdForPatientScope', {
                value: true, writable: true, configurable: true
            });

            mockSearchQueryBuilder = createMockInstance(SearchQueryBuilder);
            mockSearchQueryBuilder.buildSearchQueryBasedOnVersion = jest.fn().mockReturnValue({
                query: {}, columns: new Set()
            });

            mockSecurityTagManager = createMockInstance(SecurityTagManager);
            mockSecurityTagManager.getSecurityTagsFromScope = jest.fn().mockReturnValue([]);

            mockQueryRewriterManager = createMockInstance(QueryRewriterManager);
            mockQueryRewriterManager.rewriteQueryAsync = jest.fn().mockImplementation(
                async ({ query, columns }) => ({ query, columns })
            );

            searchManager = new SearchManager({
                databaseQueryFactory: createMockInstance(DatabaseQueryFactory),
                resourceLocatorFactory: createMockInstance(ResourceLocatorFactory),
                securityTagManager: mockSecurityTagManager,
                resourcePreparer: createMockInstance(ResourcePreparer),
                indexHinter: createMockInstance(IndexHinter),
                r4SearchQueryCreator: createMockInstance(R4SearchQueryCreator),
                configManager: mockConfigManager,
                queryRewriterManager: mockQueryRewriterManager,
                scopesManager: mockScopesManager,
                databaseAttachmentManager: createMockInstance(DatabaseAttachmentManager),
                base64DataManager: createMockInstance(Base64DataManager),
                fhirResourceWriterFactory: createMockInstance(FhirResourceWriterFactory),
                dataSharingManager: mockDataSharingManager,
                searchQueryBuilder: mockSearchQueryBuilder,
                patientScopeManager: mockPatientScopeManager,
                patientQueryCreator: mockPatientQueryCreator,
                searchParametersManager: createMockInstance(SearchParametersManager)
            });
        });

        async function callConstructQuery ({ resourceType, userType }) {
            return searchManager.constructQueryAsync({
                user: 'cms-user-1',
                scope: 'patient/Patient.read',
                isUser: true,
                userType,
                resourceType,
                useAccessIndex: false,
                personIdFromJwtToken: 'person-1',
                requestId: 'req-1',
                parsedArgs: { base_version: '4_0_0', parsedArgItems: [] },
                useHistoryTable: false,
                operation: 'READ'
            });
        }

        test('invokes updateQueryConsideringCmsDataSharing when resourceType is Patient AND userType is cms-partner', async () => {
            await callConstructQuery({ resourceType: 'Patient', userType: AUTH_USER_TYPES.cmsPartnerUser });

            expect(mockDataSharingManager.updateQueryConsideringCmsDataSharing).toHaveBeenCalledTimes(1);
        });

        test('does NOT invoke it when resourceType is Patient but userType is not cms-partner', async () => {
            await callConstructQuery({ resourceType: 'Patient', userType: 'some-other-user-type' });

            expect(mockDataSharingManager.updateQueryConsideringCmsDataSharing).not.toHaveBeenCalled();
        });

        test('does NOT invoke it when userType is cms-partner but resourceType is not Patient', async () => {
            await callConstructQuery({ resourceType: 'Observation', userType: AUTH_USER_TYPES.cmsPartnerUser });

            expect(mockDataSharingManager.updateQueryConsideringCmsDataSharing).not.toHaveBeenCalled();
        });

        test('does NOT invoke it when neither condition holds', async () => {
            await callConstructQuery({ resourceType: 'Observation', userType: undefined });

            expect(mockDataSharingManager.updateQueryConsideringCmsDataSharing).not.toHaveBeenCalled();
        });
    });

    describe('DataSharingManager.updateQueryConsideringCmsDataSharing (real DataSharingManager + real CmsConsentManager)', () => {
        const PATIENT_UUID = 'patient-uuid-1';
        const PERSON_UUID = 'person-uuid-a';

        /** @type {DataSharingManager} */
        let dataSharingManager;
        let mockBwellPersonFinder;
        let mockDatabaseQueryFactory;
        let capturedConsentFindArgs;

        function buildConsentCursor (consentResources) {
            return {
                hint: jest.fn().mockReturnThis(),
                toArrayAsync: jest.fn().mockResolvedValue(consentResources)
            };
        }

        beforeEach(() => {
            mockBwellPersonFinder = createMockInstance(BwellPersonFinder);
            mockBwellPersonFinder.getImmediatePersonIdsOfPatientsAsync = jest.fn().mockResolvedValue({
                patientReferenceToPersonUuid: { [PATIENT_UUID]: [PERSON_UUID] }
            });

            capturedConsentFindArgs = undefined;

            // Default: no Consent found for the caller's linked patients.
            mockDatabaseQueryFactory = createMockInstance(DatabaseQueryFactory);
            mockDatabaseQueryFactory.createQuery = jest.fn(({ resourceType }) => {
                if (resourceType !== 'Consent') {
                    throw new Error(`Unexpected resourceType in test setup: ${resourceType}`);
                }
                return {
                    findAsync: jest.fn((args) => {
                        capturedConsentFindArgs = args;
                        return Promise.resolve(buildConsentCursor([]));
                    })
                };
            });

            dataSharingManager = new DataSharingManager({
                databaseQueryFactory: mockDatabaseQueryFactory,
                configManager: createMockInstance(ConfigManager),
                patientFilterManager: createMockInstance(PatientFilterManager),
                searchQueryBuilder: createMockInstance(SearchQueryBuilder),
                bwellPersonFinder: mockBwellPersonFinder,
                proaConsentManager: createMockInstance(ProaConsentManager),
                cmsConsentManager: new CmsConsentManager({ databaseQueryFactory: mockDatabaseQueryFactory }),
                requestSpecificCache: new RequestSpecificCache(),
                delegatedAccessRulesManager: createMockInstance(DelegatedAccessRulesManager)
            });
        });

        test('self-contained guard: returns the query unchanged when resourceType is not Patient (even if callers upstream mis-invoke it)', async () => {
            const query = { resourceType: 'Observation' };

            const result = await dataSharingManager.updateQueryConsideringCmsDataSharing({
                resourceType: 'Observation',
                patientIds: [PATIENT_UUID],
                query,
                actor: null,
                securityTags: ['tenant-a']
            });

            expect(result).toBe(query);
            expect(mockBwellPersonFinder.getImmediatePersonIdsOfPatientsAsync).not.toHaveBeenCalled();
        });

        test('FAILS CLOSED: returns the impossible query { _uuid: "__invalid__" } when no consent is found for any linked patient — does not fall back to unrestricted access', async () => {
            const originalQuery = { 'meta.security': { $elemMatch: { code: 'tenant-a' } } };

            const result = await dataSharingManager.updateQueryConsideringCmsDataSharing({
                resourceType: 'Patient',
                patientIds: [PATIENT_UUID],
                query: originalQuery,
                actor: null,
                securityTags: ['tenant-a']
            });

            expect(result).toEqual({ _uuid: '__invalid__' });
            // Confirms this is a hard replacement of the original query, not a merge/AND that
            // could accidentally leave the original (unrestricted) filter reachable.
            expect(result).not.toEqual(originalQuery);
            expect(JSON.stringify(result)).not.toContain('tenant-a');
        });

        test('queries Mongo for active, permit-type, CMS-data-sharing-category Consents (verified against the real query sent to the DB layer)', async () => {
            await dataSharingManager.updateQueryConsideringCmsDataSharing({
                resourceType: 'Patient',
                patientIds: [PATIENT_UUID],
                query: {},
                actor: null,
                securityTags: ['tenant-a']
            });

            expect(capturedConsentFindArgs).toBeDefined();
            expect(capturedConsentFindArgs.query.$and).toContainEqual({ status: 'active' });
            expect(capturedConsentFindArgs.query.$and).toContainEqual({ 'provision.type': 'permit' });
            expect(capturedConsentFindArgs.query.$and).toContainEqual({
                'category.coding': {
                    $elemMatch: {
                        system: 'http://www.icanbwell.com/consent-category',
                        code: 'cms:share:records'
                    }
                }
            });
        });

        test('restricts (not expands) Patient search to consented patient uuids when consent exists', async () => {
            mockDatabaseQueryFactory.createQuery.mockImplementation(({ resourceType }) => {
                if (resourceType !== 'Consent') {
                    throw new Error(`Unexpected resourceType in test setup: ${resourceType}`);
                }
                return {
                    findAsync: jest.fn().mockResolvedValue(buildConsentCursor([
                        {
                            _uuid: 'consent-uuid-1',
                            patient: { _uuid: `Patient/person.${PERSON_UUID}` },
                            meta: { versionId: '1', lastUpdated: '2024-06-01T00:00:00.000Z' }
                        }
                    ]))
                };
            });

            const originalQuery = { resourceType: 'Patient' };
            const result = await dataSharingManager.updateQueryConsideringCmsDataSharing({
                resourceType: 'Patient',
                patientIds: [PATIENT_UUID],
                query: originalQuery,
                actor: null,
                securityTags: ['tenant-a']
            });

            // This is a restriction ($and), unlike PROA/IAS's OR-expansion (§6a): the original
            // query still applies, narrowed further to only the consented patient uuid(s).
            expect(result.$and).toBeDefined();
            expect(result.$and[0]).toEqual(originalQuery);
            expect(result.$and[1]).toEqual({ _uuid: { $in: [PATIENT_UUID] } });
        });

        test('sets actor.consentPolicy to the matching Consent reference when an actor is supplied', async () => {
            mockDatabaseQueryFactory.createQuery.mockImplementation(({ resourceType }) => {
                if (resourceType !== 'Consent') {
                    throw new Error(`Unexpected resourceType in test setup: ${resourceType}`);
                }
                return {
                    findAsync: jest.fn().mockResolvedValue(buildConsentCursor([
                        {
                            _uuid: 'consent-uuid-9',
                            patient: { _uuid: `Patient/person.${PERSON_UUID}` },
                            meta: { versionId: '4', lastUpdated: '2024-06-01T00:00:00.000Z' }
                        }
                    ]))
                };
            });

            const actor = { reference: 'RelatedPerson/actor-1' };
            await dataSharingManager.updateQueryConsideringCmsDataSharing({
                resourceType: 'Patient',
                patientIds: [PATIENT_UUID],
                query: {},
                actor,
                securityTags: ['tenant-a']
            });

            expect(actor.consentPolicy).toBe('Consent/consent-uuid-9?version=4');
        });
    });
});
