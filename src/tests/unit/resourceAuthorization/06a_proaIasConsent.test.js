'use strict';

/**
 * Regression tests for docs/resource-authorization.md §6a "PROA/IAS data-sharing consent".
 *
 * Verifies, against the REAL implementations (never a stand-in class):
 *   - `DataSharingManager.updateQueryConsideringDataSharing`
 *     (src/operations/search/dataSharingManager.js) is gated by
 *     `ConfigManager.enableConsentedProaDataAccess` (env `ENABLE_CONSENTED_PROA_DATA_ACCESS`)
 *     AND the caller-supplied `allowConsentedProaDataAccess` flag — both must be true.
 *   - It delegates to the REAL `ProaConsentManager.getPatientIdsWithConsent` ->
 *     `getConsentResources` (src/operations/search/proaConsentManager.js) to look up consent, and
 *     that lookup queries Mongo for `status: 'active'` and `provision.type: 'permit'` Consents —
 *     i.e. the "active, permit-type" claim is verified against the actual query sent to the DB
 *     layer, not merely asserted.
 *   - When a qualifying Consent exists, the mechanism EXPANDS visibility: the final query is
 *     exactly `{ $or: [originalQuery, queryWithConsentedData] }`, never a further restriction of
 *     `originalQuery`.
 *   - When no qualifying Consent is found, the query comes back completely unchanged (no `$or`)
 *     — absence of PROA consent must not narrow what the caller could otherwise already see.
 *
 * Only true external collaborators (ConfigManager, PatientFilterManager, SearchQueryBuilder,
 * BwellPersonFinder, the Mongo-facing DatabaseQueryFactory, RequestSpecificCache's logging,
 * express-http-context) are mocked; DataSharingManager and ProaConsentManager are required from
 * their real source paths and exercised as real instances wired together.
 */
const { describe, test, expect, beforeEach, afterEach, jest } = require('@jest/globals');

// These jest.mock calls MUST run before anything below requires the real source modules —
// this repo's babel/jest setup does not hoist jest.mock() above require() the way
// babel-plugin-jest-hoist normally would (see scopesManager.crossTenant.test.js for the same
// convention), so DataSharingManager's own internal `require('express-http-context')` would
// otherwise bind to the real module before this mock is registered.
jest.mock('express-http-context', () => ({
    set: jest.fn(),
    get: jest.fn()
}));

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

const { DataSharingManager } = require('../../../operations/search/dataSharingManager');
const { ProaConsentManager } = require('../../../operations/search/proaConsentManager');
const { CmsConsentManager } = require('../../../operations/search/cmsConsentManager');
const { DatabaseQueryFactory } = require('../../../dataLayer/databaseQueryFactory');
const { ConfigManager } = require('../../../utils/configManager');
const { PatientFilterManager } = require('../../../fhir/patientFilterManager');
const { SearchQueryBuilder } = require('../../../operations/search/searchQueryBuilder');
const { BwellPersonFinder } = require('../../../utils/bwellPersonFinder');
const { RequestSpecificCache } = require('../../../utils/requestSpecificCache');
const { DelegatedAccessRulesManager } = require('../../../utils/delegatedAccessRulesManager');
const { ParsedArgs } = require('../../../operations/query/parsedArgs');
const { HTTP_CONTEXT_KEYS } = require('../../../constants');

const httpContext = require('express-http-context');

function createMockInstance (ClassType) {
    return Object.create(ClassType.prototype);
}

describe('Resource Authorization §6a — PROA/IAS data-sharing consent', () => {
    const PATIENT_UUID = 'patient-uuid-input';
    const PERSON_UUID = 'person-uuid-a';
    const ORIGINAL_QUERY = { 'meta.security': { $elemMatch: { system: 'https://www.icanbwell.com/access', code: { $in: ['tenant-a'] } } } };

    /** @type {DataSharingManager} */
    let dataSharingManager;
    let mockConfigManager;
    let mockPatientFilterManager;
    let mockSearchQueryBuilder;
    let mockBwellPersonFinder;
    let mockDatabaseQueryFactory;
    let capturedConsentFindArgs;

    /**
     * Builds parsedArgs representing a single `patient=Patient/<PATIENT_UUID>` search parameter
     * on a non-Patient clinical resource (e.g. `Observation?patient=...`).
     */
    function buildParsedArgsWithPatientFilter () {
        const parsedArgs = createMockInstance(ParsedArgs);
        const item = {
            propertyObj: { target: ['Patient'] },
            references: [{ resourceType: 'Patient', id: PATIENT_UUID }],
            queryParameter: 'patient',
            queryParameterValue: {
                values: [`Patient/${PATIENT_UUID}`],
                operator: '$or',
                regenerateValueFromValues: jest.fn().mockReturnValue(`Patient/${PATIENT_UUID}`)
            },
            modifiers: []
        };
        parsedArgs.parsedArgItems = [item];
        parsedArgs.base_version = '4_0_0';
        parsedArgs.clone = jest.fn().mockReturnValue({
            parsedArgItems: [{ ...item }]
        });
        return parsedArgs;
    }

    beforeEach(() => {
        mockConfigManager = createMockInstance(ConfigManager);
        Object.defineProperty(mockConfigManager, 'enableConsentedProaDataAccess', { value: false, writable: true, configurable: true });
        Object.defineProperty(mockConfigManager, 'getConsentConnectionTypesList', { value: ['proa'], writable: true, configurable: true });
        Object.defineProperty(mockConfigManager, 'getDataSharingConsentCodes', { value: ['proaConsent'], writable: true, configurable: true });

        mockPatientFilterManager = createMockInstance(PatientFilterManager);
        mockPatientFilterManager.isPatientRelatedResource = jest.fn().mockReturnValue(true);

        mockSearchQueryBuilder = createMockInstance(SearchQueryBuilder);
        mockSearchQueryBuilder.buildSearchQueryBasedOnVersion = jest.fn().mockReturnValue({
            query: { 'subject._uuid': PATIENT_UUID }
        });

        mockBwellPersonFinder = createMockInstance(BwellPersonFinder);
        mockBwellPersonFinder.getImmediatePersonIdsOfPatientsAsync = jest.fn().mockResolvedValue({
            patientReferenceToPersonUuid: { [PATIENT_UUID]: [PERSON_UUID] },
            personToLinkedPatientsMap: new Map([[PERSON_UUID, [`Patient/${PATIENT_UUID}`]]])
        });

        capturedConsentFindArgs = undefined;

        const patientCursor = {
            hasNext: jest.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false),
            nextObject: jest.fn().mockResolvedValue({
                id: PATIENT_UUID,
                _sourceId: PATIENT_UUID,
                _uuid: PATIENT_UUID,
                meta: { security: [{ system: 'https://www.icanbwell.com/connectionType', code: 'proa' }] }
            })
        };

        // Default: no Consent resources found. Individual tests override this to simulate an
        // active, permit-type Consent existing.
        const consentCursor = {
            hint: jest.fn().mockReturnThis(),
            sort: jest.fn().mockReturnThis(),
            toArrayAsync: jest.fn().mockResolvedValue([])
        };

        mockDatabaseQueryFactory = createMockInstance(DatabaseQueryFactory);
        mockDatabaseQueryFactory.createQuery = jest.fn(({ resourceType }) => {
            if (resourceType === 'Patient') {
                return { findAsync: jest.fn().mockResolvedValue(patientCursor) };
            }
            if (resourceType === 'Consent') {
                return {
                    findAsync: jest.fn((args) => {
                        capturedConsentFindArgs = args;
                        return Promise.resolve(consentCursor);
                    })
                };
            }
            throw new Error(`Unexpected resourceType in test setup: ${resourceType}`);
        });

        dataSharingManager = new DataSharingManager({
            databaseQueryFactory: mockDatabaseQueryFactory,
            configManager: mockConfigManager,
            patientFilterManager: mockPatientFilterManager,
            searchQueryBuilder: mockSearchQueryBuilder,
            bwellPersonFinder: mockBwellPersonFinder,
            proaConsentManager: new ProaConsentManager({
                databaseQueryFactory: mockDatabaseQueryFactory,
                configManager: mockConfigManager
            }),
            cmsConsentManager: createMockInstance(CmsConsentManager),
            requestSpecificCache: new RequestSpecificCache(),
            delegatedAccessRulesManager: createMockInstance(DelegatedAccessRulesManager)
        });
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    describe('gate: ConfigManager.enableConsentedProaDataAccess AND allowConsentedProaDataAccess', () => {
        test('does not consult ProaConsentManager and returns the query unchanged when enableConsentedProaDataAccess is false', async () => {
            mockConfigManager.enableConsentedProaDataAccess = false;
            const getPatientIdsSpy = jest.spyOn(dataSharingManager.proaConsentManager, 'getPatientIdsWithConsent');

            const result = await dataSharingManager.updateQueryConsideringDataSharing({
                base_version: '4_0_0',
                resourceType: 'Observation',
                parsedArgs: buildParsedArgsWithPatientFilter(),
                securityTags: ['tenant-a'],
                query: ORIGINAL_QUERY,
                useHistoryTable: false,
                requestId: undefined,
                isUser: false,
                allowConsentedProaDataAccess: true
            });

            expect(getPatientIdsSpy).not.toHaveBeenCalled();
            expect(result).toEqual(ORIGINAL_QUERY);
            expect(httpContext.set).not.toHaveBeenCalledWith(HTTP_CONTEXT_KEYS.CONSENTED_PROA_DATA_ACCESSED, true);
        });

        test('does not consult ProaConsentManager when config is enabled but the caller-level allowConsentedProaDataAccess flag is false', async () => {
            mockConfigManager.enableConsentedProaDataAccess = true;
            const getPatientIdsSpy = jest.spyOn(dataSharingManager.proaConsentManager, 'getPatientIdsWithConsent');

            const result = await dataSharingManager.updateQueryConsideringDataSharing({
                base_version: '4_0_0',
                resourceType: 'Observation',
                parsedArgs: buildParsedArgsWithPatientFilter(),
                securityTags: ['tenant-a'],
                query: ORIGINAL_QUERY,
                useHistoryTable: false,
                requestId: undefined,
                isUser: false,
                allowConsentedProaDataAccess: false
            });

            expect(getPatientIdsSpy).not.toHaveBeenCalled();
            expect(result).toEqual(ORIGINAL_QUERY);
        });
    });

    describe('consent-driven expansion (active, permit-type Consent)', () => {
        beforeEach(() => {
            mockConfigManager.enableConsentedProaDataAccess = true;
        });

        test('queries Mongo for active, permit-type Consents (verified against the real query sent to the DB layer)', async () => {
            await dataSharingManager.updateQueryConsideringDataSharing({
                base_version: '4_0_0',
                resourceType: 'Observation',
                parsedArgs: buildParsedArgsWithPatientFilter(),
                securityTags: ['tenant-a'],
                query: ORIGINAL_QUERY,
                useHistoryTable: false,
                requestId: undefined,
                isUser: false,
                allowConsentedProaDataAccess: true
            });

            expect(capturedConsentFindArgs).toBeDefined();
            expect(capturedConsentFindArgs.query.$and).toContainEqual({ status: 'active' });
            expect(capturedConsentFindArgs.query.$and).toContainEqual({ 'provision.type': 'permit' });
        });

        test('ORs a connection-type-filtered consent branch onto the search: final query is { $or: [originalQuery, queryWithConsentedData] }', async () => {
            const consentCursorWithMatch = {
                hint: jest.fn().mockReturnThis(),
                sort: jest.fn().mockReturnThis(),
                toArrayAsync: jest.fn().mockResolvedValue([
                    { patient: { _uuid: `Patient/${PATIENT_UUID}` }, meta: { versionId: '1', lastUpdated: '2024-01-01' } }
                ])
            };
            mockDatabaseQueryFactory.createQuery.mockImplementation(({ resourceType }) => {
                if (resourceType === 'Patient') {
                    return {
                        findAsync: jest.fn().mockResolvedValue({
                            hasNext: jest.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false),
                            nextObject: jest.fn().mockResolvedValue({
                                id: PATIENT_UUID,
                                _sourceId: PATIENT_UUID,
                                _uuid: PATIENT_UUID,
                                meta: { security: [{ system: 'https://www.icanbwell.com/connectionType', code: 'proa' }] }
                            })
                        })
                    };
                }
                return { findAsync: jest.fn().mockResolvedValue(consentCursorWithMatch) };
            });

            const result = await dataSharingManager.updateQueryConsideringDataSharing({
                base_version: '4_0_0',
                resourceType: 'Observation',
                parsedArgs: buildParsedArgsWithPatientFilter(),
                securityTags: ['tenant-a'],
                query: ORIGINAL_QUERY,
                useHistoryTable: false,
                requestId: undefined,
                isUser: false,
                allowConsentedProaDataAccess: true
            });

            // Expansion, not restriction: the original query is preserved verbatim as one OR branch.
            expect(result.$or).toBeDefined();
            expect(result.$or).toHaveLength(2);
            expect(result.$or[0]).toEqual(ORIGINAL_QUERY);

            // The other branch is the connection-type-filtered consent query: the rebuilt
            // patient-scoped search AND'd with a meta.security connectionType restriction (§8).
            expect(result.$or[1]).toEqual({
                $and: [
                    { 'subject._uuid': PATIENT_UUID },
                    {
                        'meta.security': {
                            $elemMatch: {
                                system: 'https://www.icanbwell.com/connectionType',
                                code: { $in: ['proa'] }
                            }
                        }
                    }
                ]
            });

            // Flag set for downstream auditing only when consented data actually widened the query.
            expect(httpContext.set).toHaveBeenCalledWith(HTTP_CONTEXT_KEYS.CONSENTED_PROA_DATA_ACCESSED, true);
        });

        test('does not expand the query (and leaves the original query untouched) when no qualifying Consent is found', async () => {
            // Default beforeEach setup already returns an empty Consent list.
            const result = await dataSharingManager.updateQueryConsideringDataSharing({
                base_version: '4_0_0',
                resourceType: 'Observation',
                parsedArgs: buildParsedArgsWithPatientFilter(),
                securityTags: ['tenant-a'],
                query: ORIGINAL_QUERY,
                useHistoryTable: false,
                requestId: undefined,
                isUser: false,
                allowConsentedProaDataAccess: true
            });

            expect(result).toEqual(ORIGINAL_QUERY);
            expect(result.$or).toBeUndefined();
            expect(httpContext.set).not.toHaveBeenCalledWith(HTTP_CONTEXT_KEYS.CONSENTED_PROA_DATA_ACCESSED, true);
        });
    });
});
