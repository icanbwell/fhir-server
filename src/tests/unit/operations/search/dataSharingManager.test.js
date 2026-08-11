'use strict';

/**
 * Unit tests for DataSharingManager
 *
 * CACHE ANALYSIS:
 * 1. Cache mechanism: RequestSpecificCache.getMap({ requestId, name: 'dataSharingManager' }) at line 107
 * 2. Cache KEY dimensions: requestId (single param)
 * 3. Method PARAMETERS: base_version, resourceType, parsedArgs, securityTags, query, useHistoryTable, requestId, isUser
 * 4. Params NOT in cache key: base_version, resourceType, parsedArgs, securityTags, query, useHistoryTable, isUser
 * 5. Cached VALUE: patientIdToImmediatePersonUuid, patientsList, personToLinkedPatientsMap, allowedPatientIds
 * 6. Downstream consumer: getConnectionTypeFilteredQuery and filterPatientsByConnectionType
 * 7. REQUIRED TEST: same requestId, different resourceType/parsedArgs/securityTags
 * 8. MOCK SETUP: downstream uses cached patientIdToImmediatePersonUuid value
 * 9. ASSERTION: result2 uses call1's cached patient map, not call2's real one
 */

const { describe, beforeEach, afterEach, it, expect, jest } = require('@jest/globals');

const { DataSharingManager } = require('../../../../operations/search/dataSharingManager');
const { DatabaseQueryFactory } = require('../../../../dataLayer/databaseQueryFactory');
const { ConfigManager } = require('../../../../utils/configManager');
const { PatientFilterManager } = require('../../../../fhir/patientFilterManager');
const { SearchQueryBuilder } = require('../../../../operations/search/searchQueryBuilder');
const { BwellPersonFinder } = require('../../../../utils/bwellPersonFinder');
const { ProaConsentManager } = require('../../../../operations/search/proaConsentManager');
const { CmsConsentManager } = require('../../../../operations/search/cmsConsentManager');
const { RequestSpecificCache } = require('../../../../utils/requestSpecificCache');
const { DelegatedAccessRulesManager } = require('../../../../utils/delegatedAccessRulesManager');
const { ParsedArgs } = require('../../../../operations/query/parsedArgs');
const httpContext = require('express-http-context');
const { DATA_SHARING_PATIENT_TO_PERSON_DATA } = require('../../../../constants');

// Mock httpContext
jest.mock('express-http-context', () => ({
    set: jest.fn(),
    get: jest.fn()
}));

// Mock logging
jest.mock('../../../../operations/common/logging', () => ({
    logError: jest.fn(),
    logInfo: jest.fn(),
    logDebug: jest.fn()
}));

jest.mock('../../../../operations/common/systemEventLogging', () => ({
    logTraceSystemEventAsync: jest.fn(),
    logSystemEventAsync: jest.fn()
}));

describe('DataSharingManager', () => {
    let dataSharingManager;
    let mockDatabaseQueryFactory;
    let mockConfigManager;
    let mockPatientFilterManager;
    let mockSearchQueryBuilder;
    let mockBwellPersonFinder;
    let mockProaConsentManager;
    let mockCmsConsentManager;
    let requestSpecificCache;
    let mockDelegatedAccessRulesManager;

    beforeEach(() => {
        mockDatabaseQueryFactory = Object.create(DatabaseQueryFactory.prototype);
        mockConfigManager = Object.create(ConfigManager.prototype);
        Object.defineProperty(mockConfigManager, 'enableConsentedProaDataAccess', { value: false, writable: true, configurable: true });
        Object.defineProperty(mockConfigManager, 'getConsentConnectionTypesList', { value: [], writable: true, configurable: true });
        mockPatientFilterManager = Object.create(PatientFilterManager.prototype);
        mockSearchQueryBuilder = Object.create(SearchQueryBuilder.prototype);
        mockBwellPersonFinder = Object.create(BwellPersonFinder.prototype);
        mockProaConsentManager = Object.create(ProaConsentManager.prototype);
        mockCmsConsentManager = Object.create(CmsConsentManager.prototype);
        requestSpecificCache = new RequestSpecificCache();
        mockDelegatedAccessRulesManager = Object.create(DelegatedAccessRulesManager.prototype);

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

    afterEach(() => {
        jest.clearAllMocks();
    });

    // ============================================================
    // Top 3 largest methods:
    // 1. updateQueryConsideringDataSharing (lines 124-265)
    // 2. getConnectionTypeFilteredQuery (lines 392-497)
    // 3. getValidatedPatientIdsMap (lines 330-375)
    // ============================================================

    describe('updateQueryConsideringDataSharing', () => {
        let mockParsedArgs;

        beforeEach(() => {
            mockParsedArgs = Object.create(ParsedArgs.prototype);
            mockParsedArgs.parsedArgItems = [];
            mockParsedArgs.base_version = '4_0_0';

            mockPatientFilterManager.isPatientRelatedResource = jest.fn().mockReturnValue(true);
            mockBwellPersonFinder.getImmediatePersonIdsOfPatientsAsync = jest.fn().mockResolvedValue({
                patientReferenceToPersonUuid: { 'patient-uuid-1': ['person-uuid-1'] },
                personToLinkedPatientsMap: new Map()
            });

            mockConfigManager.enableConsentedProaDataAccess = true;
            mockConfigManager.getConsentConnectionTypesList = ['proa'];
        });

        it('returns original query when no requestId and patientIdToImmediatePersonUuid is empty', async () => {
            mockPatientFilterManager.isPatientRelatedResource = jest.fn().mockReturnValue(false);

            const query = { _uuid: 'test' };
            const result = await dataSharingManager.updateQueryConsideringDataSharing({
                base_version: '4_0_0',
                resourceType: 'Observation',
                parsedArgs: mockParsedArgs,
                securityTags: ['client-abc'],
                query,
                useHistoryTable: false,
                requestId: null,
                isUser: false,
                allowConsentedProaDataAccess: true
            });

            expect(result).toEqual(query);
        });

        it('caches patientIdToImmediatePersonUuid on first call and reuses on second call', async () => {
            // Setup parsedArgs to return patient references
            const mockArgItem = {
                propertyObj: { target: ['Patient'] },
                references: [{ resourceType: 'Patient', id: 'patient-uuid-1' }],
                queryParameter: 'patient',
                queryParameterValue: { values: ['Patient/patient-uuid-1'], operator: '$or', regenerateValueFromValues: jest.fn().mockReturnValue('Patient/patient-uuid-1') },
                modifiers: [],
                clone: function () { return { ...this }; }
            };
            mockParsedArgs.parsedArgItems = [mockArgItem];
            mockParsedArgs.clone = jest.fn().mockReturnValue({ ...mockParsedArgs, parsedArgItems: [{ ...mockArgItem }] });

            const mockCursor = {
                hasNext: jest.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false),
                nextObject: jest.fn().mockResolvedValue({
                    id: 'patient-1',
                    _sourceId: 'patient-1',
                    _uuid: 'patient-uuid-1',
                    meta: { security: [{ system: 'https://www.icanbwell.com/connectionType', code: 'proa' }] }
                })
            };
            mockDatabaseQueryFactory.createQuery = jest.fn().mockReturnValue({
                findAsync: jest.fn().mockResolvedValue(mockCursor)
            });

            mockProaConsentManager.getPatientIdsWithConsent = jest.fn().mockResolvedValue(new Set(['patient-uuid-1']));

            mockSearchQueryBuilder.buildSearchQueryBasedOnVersion = jest.fn().mockReturnValue({
                query: { 'subject.reference': 'Patient/patient-uuid-1' }
            });

            const requestId = 'req-shared-cache';
            const query1 = { _uuid: { $in: ['abc'] } };

            // First call - populates cache
            await dataSharingManager.updateQueryConsideringDataSharing({
                base_version: '4_0_0',
                resourceType: 'Observation',
                parsedArgs: mockParsedArgs,
                securityTags: ['client-abc'],
                query: query1,
                useHistoryTable: false,
                requestId,
                isUser: false,
                allowConsentedProaDataAccess: true
            });

            // Verify bwellPersonFinder was called on first invocation
            expect(mockBwellPersonFinder.getImmediatePersonIdsOfPatientsAsync).toHaveBeenCalledTimes(1);

            // Second call with same requestId but different resourceType
            const query2 = { _uuid: { $in: ['def'] } };
            // Reset the cursor for second call's getPatientIDToConnectionTypeMap
            const mockCursor2 = {
                hasNext: jest.fn().mockResolvedValue(false),
                nextObject: jest.fn()
            };
            mockDatabaseQueryFactory.createQuery = jest.fn().mockReturnValue({
                findAsync: jest.fn().mockResolvedValue(mockCursor2)
            });

            await dataSharingManager.updateQueryConsideringDataSharing({
                base_version: '4_0_0',
                resourceType: 'Condition',
                parsedArgs: mockParsedArgs,
                // Same securityTags as call 1 - this test is about resourceType varying,
                // not securityTags. See the dedicated securityTags-cache-key test below.
                securityTags: ['client-abc'],
                query: query2,
                useHistoryTable: false,
                requestId,
                isUser: false,
                allowConsentedProaDataAccess: true
            });

            // bwellPersonFinder should NOT be called again - used cache
            expect(mockBwellPersonFinder.getImmediatePersonIdsOfPatientsAsync).toHaveBeenCalledTimes(1);
        });

        it('second call with same requestId but different securityTags must NOT use cached patientIds', async () => {
            // This tests the cache-key fix: securityTags must be part of the cache key,
            // so a second call in the same request with different securityTags re-derives
            // patientIdToImmediatePersonUuid instead of reusing the first call's cache entry.
            const requestId = 'req-shared';
            const patientUuid = '11111111-1111-1111-1111-111111111111';

            const buildParsedArgs = () => ({
                base_version: '4_0_0',
                parsedArgItems: [{
                    propertyObj: { target: ['Patient'] },
                    references: [{ resourceType: 'Patient', id: patientUuid }],
                    queryParameter: 'patient',
                    queryParameterValue: {
                        values: [`Patient/${patientUuid}`],
                        operator: '$or',
                        regenerateValueFromValues: jest.fn().mockReturnValue(`Patient/${patientUuid}`)
                    },
                    modifiers: []
                }]
            });
            mockParsedArgs.parsedArgItems = buildParsedArgs().parsedArgItems;
            mockParsedArgs.clone = jest.fn().mockReturnValue(buildParsedArgs());

            const mockCursor = {
                hasNext: jest.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false),
                nextObject: jest.fn().mockResolvedValue({
                    id: 'patient-1',
                    _sourceId: 'patient-1',
                    _uuid: patientUuid,
                    meta: { security: [{ system: 'https://www.icanbwell.com/connectionType', code: 'proa' }] }
                })
            };
            mockDatabaseQueryFactory.createQuery = jest.fn().mockReturnValue({
                findAsync: jest.fn().mockResolvedValue(mockCursor)
            });
            mockBwellPersonFinder.getImmediatePersonIdsOfPatientsAsync = jest.fn().mockResolvedValue({
                patientReferenceToPersonUuid: { [patientUuid]: ['person-uuid-1'] },
                personToLinkedPatientsMap: new Map()
            });
            mockProaConsentManager.getPatientIdsWithConsent = jest.fn().mockResolvedValue(new Set([patientUuid]));
            mockSearchQueryBuilder.buildSearchQueryBasedOnVersion = jest.fn().mockReturnValue({
                query: { 'subject.reference': `Patient/${patientUuid}` }
            });

            // Call 1 with securityTags = ['client-A']
            const result1 = await dataSharingManager.updateQueryConsideringDataSharing({
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
            expect(mockBwellPersonFinder.getImmediatePersonIdsOfPatientsAsync).toHaveBeenCalledTimes(1);
            expect(result1.$or).toBeDefined();
            expect(result1.$or[0]).toEqual({ access: 'A' });

            // Call 2 with securityTags = ['client-B'] but same requestId: must NOT reuse
            // call 1's cache entry - bwellPersonFinder must be called again.
            // Fresh cursor mock since call 1's one-shot hasNext/nextObject values are spent.
            const mockCursor2 = {
                hasNext: jest.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false),
                nextObject: jest.fn().mockResolvedValue({
                    id: 'patient-1',
                    _sourceId: 'patient-1',
                    _uuid: patientUuid,
                    meta: { security: [{ system: 'https://www.icanbwell.com/connectionType', code: 'proa' }] }
                })
            };
            mockDatabaseQueryFactory.createQuery = jest.fn().mockReturnValue({
                findAsync: jest.fn().mockResolvedValue(mockCursor2)
            });

            const result2 = await dataSharingManager.updateQueryConsideringDataSharing({
                base_version: '4_0_0',
                resourceType: 'Observation',
                parsedArgs: mockParsedArgs,
                securityTags: ['client-B'],
                query: { access: 'B' },
                useHistoryTable: false,
                requestId,
                isUser: false,
                allowConsentedProaDataAccess: true
            });
            expect(mockBwellPersonFinder.getImmediatePersonIdsOfPatientsAsync).toHaveBeenCalledTimes(2);
            expect(result2.$or).toBeDefined();
            expect(result2.$or[0]).toEqual({ access: 'B' });
        });

        it('returns original query when patientIdToImmediatePersonUuid is empty (no patients found)', async () => {
            mockPatientFilterManager.isPatientRelatedResource = jest.fn().mockReturnValue(true);

            mockParsedArgs.parsedArgItems = [{
                propertyObj: { target: ['Patient'] },
                references: [{ resourceType: 'Patient', id: 'patient-1' }],
                queryParameter: 'patient',
                queryParameterValue: { values: ['Patient/patient-1'] },
                modifiers: []
            }];

            const mockCursor = { hasNext: jest.fn().mockResolvedValue(false), nextObject: jest.fn() };
            mockDatabaseQueryFactory.createQuery = jest.fn().mockReturnValue({
                findAsync: jest.fn().mockResolvedValue(mockCursor)
            });

            mockBwellPersonFinder.getImmediatePersonIdsOfPatientsAsync = jest.fn().mockResolvedValue({
                patientReferenceToPersonUuid: {},
                personToLinkedPatientsMap: new Map()
            });

            const query = { resourceType: 'Observation' };
            const result = await dataSharingManager.updateQueryConsideringDataSharing({
                base_version: '4_0_0',
                resourceType: 'Observation',
                parsedArgs: mockParsedArgs,
                securityTags: ['client-abc'],
                query,
                useHistoryTable: false,
                requestId: 'req-1',
                isUser: false,
                allowConsentedProaDataAccess: true
            });

            expect(result).toEqual(query);
        });

        it('DCON-4962: short-circuits before resolving patients when allowConsentedProaDataAccess is false, even though enableConsentedProaDataAccess is true', async () => {
            // Only the $everything operation passes allowConsentedProaDataAccess: true.
            // Search, searchById, and GraphQL all call constructQueryAsync without it,
            // so it defaults to false -- this must be a true no-op for them, not just an
            // expansion that happens to compute to nothing.
            const getValidatedPatientIdsMapSpy = jest.spyOn(dataSharingManager, 'getValidatedPatientIdsMap');
            const getPatientIDToConnectionTypeMapSpy = jest.spyOn(dataSharingManager, 'getPatientIDToConnectionTypeMap');

            mockParsedArgs.parsedArgItems = [{
                propertyObj: { target: ['Patient'] },
                references: [{ resourceType: 'Patient', id: 'patient-1' }],
                queryParameter: 'patient',
                queryParameterValue: { values: ['Patient/patient-1'] },
                modifiers: []
            }];

            const query = { resourceType: 'Observation' };
            const result = await dataSharingManager.updateQueryConsideringDataSharing({
                base_version: '4_0_0',
                resourceType: 'Observation',
                parsedArgs: mockParsedArgs,
                securityTags: ['client-abc'],
                query,
                useHistoryTable: false,
                requestId: 'req-1',
                isUser: false,
                allowConsentedProaDataAccess: false
            });

            expect(result).toEqual(query);
            expect(getValidatedPatientIdsMapSpy).not.toHaveBeenCalled();
            expect(getPatientIDToConnectionTypeMapSpy).not.toHaveBeenCalled();
            expect(mockBwellPersonFinder.getImmediatePersonIdsOfPatientsAsync).not.toHaveBeenCalled();
        });
    });

    describe('updateQueryConsideringCmsDataSharing', () => {
        it('returns original query when resourceType is not Patient', async () => {
            const query = { 'meta.security': { $elemMatch: { code: 'client-a' } } };
            const result = await dataSharingManager.updateQueryConsideringCmsDataSharing({
                resourceType: 'Observation',
                patientIds: ['patient-1'],
                query,
                actor: null
            });
            expect(result).toEqual(query);
        });

        it('returns __invalid__ query when no patients have consent', async () => {
            mockBwellPersonFinder.getImmediatePersonIdsOfPatientsAsync = jest.fn().mockResolvedValue({
                patientReferenceToPersonUuid: { 'patient-1': ['person-1'] }
            });
            mockCmsConsentManager.getPatientIdsWithConsent = jest.fn().mockResolvedValue(new Map());

            const query = { resourceType: 'Patient' };
            const result = await dataSharingManager.updateQueryConsideringCmsDataSharing({
                resourceType: 'Patient',
                patientIds: ['patient-1'],
                query,
                actor: null
            });

            expect(result).toEqual({ _uuid: '__invalid__' });
        });

        it('adds uuid filter to query when patients have consent', async () => {
            mockBwellPersonFinder.getImmediatePersonIdsOfPatientsAsync = jest.fn().mockResolvedValue({
                patientReferenceToPersonUuid: { 'patient-1': ['person-1'] }
            });

            const consentMap = new Map();
            consentMap.set('uuid-1', { _uuid: 'consent-uuid-1', versionId: '2', updatedAt: new Date() });
            mockCmsConsentManager.getPatientIdsWithConsent = jest.fn().mockResolvedValue(consentMap);

            const query = { resourceType: 'Patient' };
            const result = await dataSharingManager.updateQueryConsideringCmsDataSharing({
                resourceType: 'Patient',
                patientIds: ['patient-1'],
                query,
                actor: null
            });

            expect(result.$and).toBeDefined();
            expect(result.$and[1]._uuid.$in).toEqual(['uuid-1']);
        });

        it('sets actor.consentPolicy when actor is provided', async () => {
            mockBwellPersonFinder.getImmediatePersonIdsOfPatientsAsync = jest.fn().mockResolvedValue({
                patientReferenceToPersonUuid: { 'patient-1': ['person-1'] }
            });

            const consentMap = new Map();
            consentMap.set('uuid-1', { _uuid: 'consent-uuid-1', versionId: '3', updatedAt: new Date() });
            mockCmsConsentManager.getPatientIdsWithConsent = jest.fn().mockResolvedValue(consentMap);

            const actor = { reference: 'Practitioner/prac-1' };
            await dataSharingManager.updateQueryConsideringCmsDataSharing({
                resourceType: 'Patient',
                patientIds: ['patient-1'],
                query: { resourceType: 'Patient' },
                actor
            });

            expect(actor.consentPolicy).toBe('Consent/consent-uuid-1?version=3');
        });

        it('SEC-1586: threads securityTags through to cmsConsentManager.getPatientIdsWithConsent', async () => {
            mockBwellPersonFinder.getImmediatePersonIdsOfPatientsAsync = jest.fn().mockResolvedValue({
                patientReferenceToPersonUuid: { 'patient-1': ['person-1'] }
            });
            mockCmsConsentManager.getPatientIdsWithConsent = jest.fn().mockResolvedValue(new Map());

            await dataSharingManager.updateQueryConsideringCmsDataSharing({
                resourceType: 'Patient',
                patientIds: ['patient-1'],
                query: {},
                actor: null,
                securityTags: ['tenant-a']
            });

            expect(mockCmsConsentManager.getPatientIdsWithConsent).toHaveBeenCalledWith(
                { 'patient-1': ['person-1'] },
                ['tenant-a']
            );
        });

        it('filters out person.proxy prefix ids', async () => {
            mockBwellPersonFinder.getImmediatePersonIdsOfPatientsAsync = jest.fn().mockResolvedValue({
                patientReferenceToPersonUuid: { 'patient-1': ['person-1'] }
            });
            mockCmsConsentManager.getPatientIdsWithConsent = jest.fn().mockResolvedValue(new Map());

            await dataSharingManager.updateQueryConsideringCmsDataSharing({
                resourceType: 'Patient',
                patientIds: ['person.proxy-1', 'patient-1'],
                query: {},
                actor: null
            });

            const callArgs = mockBwellPersonFinder.getImmediatePersonIdsOfPatientsAsync.mock.calls[0][0];
            expect(callArgs.patientReferences).toEqual([{ id: 'patient-1', resourceType: 'Patient' }]);
        });
    });

    describe('getValidatedPatientIdsMap', () => {
        let mockParsedArgs;

        beforeEach(() => {
            mockParsedArgs = Object.create(ParsedArgs.prototype);
            mockParsedArgs.parsedArgItems = [];
        });

        it('returns empty map when resource is not patient-related', async () => {
            mockPatientFilterManager.isPatientRelatedResource = jest.fn().mockReturnValue(false);

            const result = await dataSharingManager.getValidatedPatientIdsMap({
                resourceType: 'Organization',
                parsedArgs: mockParsedArgs,
                securityTags: ['client-abc']
            });

            expect(result.patientIdToImmediatePersonUuid).toEqual({});
        });

        it('returns empty map when no patient references in parsedArgs', async () => {
            mockPatientFilterManager.isPatientRelatedResource = jest.fn().mockReturnValue(true);
            mockParsedArgs.parsedArgItems = [{
                propertyObj: { target: ['Organization'] },
                references: [],
                queryParameter: 'organization',
                queryParameterValue: { values: [] },
                modifiers: []
            }];

            const result = await dataSharingManager.getValidatedPatientIdsMap({
                resourceType: 'Observation',
                parsedArgs: mockParsedArgs,
                securityTags: ['client-abc']
            });

            expect(result.patientIdToImmediatePersonUuid).toEqual({});
        });

        it('throws BadRequestError when multiple resources exist for same patient id', async () => {
            mockPatientFilterManager.isPatientRelatedResource = jest.fn().mockReturnValue(true);
            mockParsedArgs.parsedArgItems = [{
                propertyObj: { target: ['Patient'] },
                references: [{ resourceType: 'Patient', id: 'patient-1', sourceAssigningAuthority: null }],
                queryParameter: 'patient',
                queryParameterValue: { values: ['Patient/patient-1'] },
                modifiers: []
            }];

            const mockCursor = {
                hasNext: jest.fn()
                    .mockResolvedValueOnce(true)
                    .mockResolvedValueOnce(true)
                    .mockResolvedValueOnce(false),
                nextObject: jest.fn()
                    .mockResolvedValueOnce({ id: 'patient-1', _sourceId: 'patient-1', _uuid: 'uuid-1', meta: { security: [] } })
                    .mockResolvedValueOnce({ id: 'patient-1-dup', _sourceId: 'patient-1', _uuid: 'uuid-2', meta: { security: [] } })
            };
            mockDatabaseQueryFactory.createQuery = jest.fn().mockReturnValue({
                findAsync: jest.fn().mockResolvedValue(mockCursor)
            });

            await expect(dataSharingManager.getValidatedPatientIdsMap({
                resourceType: 'Observation',
                parsedArgs: mockParsedArgs,
                securityTags: ['client-abc']
            })).rejects.toThrow('Multiple Patient Resources');
        });
    });

    describe('getValidatedPatientIdsMap — Person/proxy-patient PROA cache branch', () => {
        let mockParsedArgs;

        beforeEach(() => {
            mockParsedArgs = Object.create(ParsedArgs.prototype);
            mockParsedArgs.parsedArgItems = [];
            mockParsedArgs.base_version = '4_0_0';
            mockPatientFilterManager.isPatientRelatedResource = jest.fn().mockReturnValue(true);
            dataSharingManager.getResourceReferencesFromFilter = jest.fn().mockReturnValue([
                { id: 'patient-1-uuid', resourceType: 'Patient' }
            ]);
            dataSharingManager.getPatientsList = jest.fn().mockResolvedValue([
                { id: 'patient-1-uuid', _uuid: 'patient-1-uuid' }
            ]);
            dataSharingManager.validatePatientIdsAsync = jest.fn().mockResolvedValue(undefined);
        });

        it('uses the RequestSpecificCache and never calls bwellPersonFinder when useProxyPatientToPersonCache is true and the cache is fully populated', async () => {
            const cache = requestSpecificCache.getMap({ requestId: 'req-1', name: DATA_SHARING_PATIENT_TO_PERSON_DATA });
            cache.set('personToLinkedPatientsMap', new Map([['person-uuid-1', ['Patient/patient-1-uuid']]]));
            cache.set('patientReferenceToPersonUuid', { 'patient-1-uuid': ['person-uuid-1'] });
            mockBwellPersonFinder.getImmediatePersonIdsOfPatientsAsync = jest.fn();

            const result = await dataSharingManager.getValidatedPatientIdsMap({
                resourceType: 'Observation',
                parsedArgs: mockParsedArgs,
                securityTags: ['tenant_a'],
                useProxyPatientToPersonCache: true,
                requestId: 'req-1'
            });

            expect(result.patientIdToImmediatePersonUuid).toEqual({ 'patient-1-uuid': ['person-uuid-1'] });
            expect(result.personToLinkedPatientsMap.get('person-uuid-1')).toEqual(['Patient/patient-1-uuid']);
            expect(mockBwellPersonFinder.getImmediatePersonIdsOfPatientsAsync).not.toHaveBeenCalled();
        });

        it('throws when useProxyPatientToPersonCache is true and the cache was never populated', async () => {
            await expect(
                dataSharingManager.getValidatedPatientIdsMap({
                    resourceType: 'Observation',
                    parsedArgs: mockParsedArgs,
                    securityTags: ['tenant_a'],
                    useProxyPatientToPersonCache: true,
                    requestId: 'req-empty'
                })
            ).rejects.toThrow(/proaSafePatientToPersonData missing/);
        });

        it('omits (does not throw for) a queried patient missing from the cache, while other cached patients still resolve', async () => {
            // A patient reachable only via a Person the caller can read but doesn't own is
            // legitimately excluded from the owner-verified cache -- not a wiring bug. It should
            // simply be omitted from the result, not cause a throw.
            dataSharingManager.getResourceReferencesFromFilter = jest.fn().mockReturnValue([
                { id: 'patient-1-uuid', resourceType: 'Patient' },
                { id: 'patient-not-cached-uuid', resourceType: 'Patient' }
            ]);
            dataSharingManager.getPatientsList = jest.fn().mockResolvedValue([
                { id: 'patient-1-uuid', _uuid: 'patient-1-uuid' },
                { id: 'patient-not-cached-uuid', _uuid: 'patient-not-cached-uuid' }
            ]);

            const cache = requestSpecificCache.getMap({ requestId: 'req-partial', name: DATA_SHARING_PATIENT_TO_PERSON_DATA });
            cache.set('personToLinkedPatientsMap', new Map([['person-uuid-1', ['Patient/patient-1-uuid']]]));
            cache.set('patientReferenceToPersonUuid', { 'patient-1-uuid': ['person-uuid-1'] });
            mockBwellPersonFinder.getImmediatePersonIdsOfPatientsAsync = jest.fn();

            const result = await dataSharingManager.getValidatedPatientIdsMap({
                resourceType: 'Observation',
                parsedArgs: mockParsedArgs,
                securityTags: ['tenant_a'],
                useProxyPatientToPersonCache: true,
                requestId: 'req-partial'
            });

            expect(result.patientIdToImmediatePersonUuid).toEqual({ 'patient-1-uuid': ['person-uuid-1'] });
            expect(result.patientIdToImmediatePersonUuid).not.toHaveProperty('patient-not-cached-uuid');
            expect(mockBwellPersonFinder.getImmediatePersonIdsOfPatientsAsync).not.toHaveBeenCalled();
        });

        it('skips PERSON_PROXY_PREFIX patient references entirely (no cache lookup, no throw) while concrete patients still resolve', async () => {
            dataSharingManager.getResourceReferencesFromFilter = jest.fn().mockReturnValue([
                { id: 'patient-1-uuid', resourceType: 'Patient' },
                { id: 'person.person-uuid-1', resourceType: 'Patient' }
            ]);
            dataSharingManager.getPatientsList = jest.fn().mockResolvedValue([
                { id: 'patient-1-uuid', _uuid: 'patient-1-uuid' }
            ]);

            const cache = requestSpecificCache.getMap({ requestId: 'req-proxy', name: DATA_SHARING_PATIENT_TO_PERSON_DATA });
            cache.set('personToLinkedPatientsMap', new Map([['person-uuid-1', ['Patient/patient-1-uuid']]]));
            cache.set('patientReferenceToPersonUuid', { 'patient-1-uuid': ['person-uuid-1'] });
            mockBwellPersonFinder.getImmediatePersonIdsOfPatientsAsync = jest.fn();

            const result = await dataSharingManager.getValidatedPatientIdsMap({
                resourceType: 'Observation',
                parsedArgs: mockParsedArgs,
                securityTags: ['tenant_a'],
                useProxyPatientToPersonCache: true,
                requestId: 'req-proxy'
            });

            expect(result.patientIdToImmediatePersonUuid).toEqual({ 'patient-1-uuid': ['person-uuid-1'] });
            expect(result.patientIdToImmediatePersonUuid).not.toHaveProperty('person.person-uuid-1');
            expect(mockBwellPersonFinder.getImmediatePersonIdsOfPatientsAsync).not.toHaveBeenCalled();
        });

        it('skips a falsy patient reference id entirely (no crash, no cache lookup) while concrete patients still resolve', async () => {
            // Fix 3: patientReference.id.startsWith(...) must be guarded by a truthiness check,
            // matching the sibling loop above it in this same method.
            dataSharingManager.getResourceReferencesFromFilter = jest.fn().mockReturnValue([
                { id: 'patient-1-uuid', resourceType: 'Patient' },
                { id: undefined, resourceType: 'Patient' }
            ]);
            dataSharingManager.getPatientsList = jest.fn().mockResolvedValue([
                { id: 'patient-1-uuid', _uuid: 'patient-1-uuid' }
            ]);

            const cache = requestSpecificCache.getMap({ requestId: 'req-falsy-id', name: DATA_SHARING_PATIENT_TO_PERSON_DATA });
            cache.set('personToLinkedPatientsMap', new Map([['person-uuid-1', ['Patient/patient-1-uuid']]]));
            cache.set('patientReferenceToPersonUuid', { 'patient-1-uuid': ['person-uuid-1'] });
            mockBwellPersonFinder.getImmediatePersonIdsOfPatientsAsync = jest.fn();

            const result = await dataSharingManager.getValidatedPatientIdsMap({
                resourceType: 'Observation',
                parsedArgs: mockParsedArgs,
                securityTags: ['tenant_a'],
                useProxyPatientToPersonCache: true,
                requestId: 'req-falsy-id'
            });

            expect(result.patientIdToImmediatePersonUuid).toEqual({ 'patient-1-uuid': ['person-uuid-1'] });
            expect(mockBwellPersonFinder.getImmediatePersonIdsOfPatientsAsync).not.toHaveBeenCalled();
        });

        it('falls through to bwellPersonFinder, unchanged, when useProxyPatientToPersonCache is false', async () => {
            mockBwellPersonFinder.getImmediatePersonIdsOfPatientsAsync = jest.fn().mockResolvedValue({
                patientReferenceToPersonUuid: { 'patient-1-uuid': ['person-uuid-1'] },
                personToLinkedPatientsMap: new Map([['person-uuid-1', ['Patient/patient-1-uuid']]])
            });

            const result = await dataSharingManager.getValidatedPatientIdsMap({
                resourceType: 'Observation',
                parsedArgs: mockParsedArgs,
                securityTags: ['tenant_a'],
                useProxyPatientToPersonCache: false,
                requestId: 'req-patient-everything'
            });

            expect(mockBwellPersonFinder.getImmediatePersonIdsOfPatientsAsync).toHaveBeenCalledWith({
                patientReferences: [{ id: 'patient-1-uuid', resourceType: 'Patient' }],
                securityTags: ['tenant_a']
            });
            expect(result.patientIdToImmediatePersonUuid).toEqual({ 'patient-1-uuid': ['person-uuid-1'] });
        });
    });

    describe('filterPatientsByConnectionType', () => {
        it('removes patient ids that do not match allowed connection types', () => {
            const allowedPatientIds = new Set(['p1', 'p2', 'p3']);
            const patientIdToConnectionTypeMap = new Map([
                ['p1', 'proa'],
                ['p2', 'hie'],
                ['p3', 'direct']
            ]);
            const allowedConnectionTypesList = ['proa', 'hie'];

            dataSharingManager.filterPatientsByConnectionType({
                allowedPatientIds,
                patientIdToConnectionTypeMap,
                allowedConnectionTypesList
            });

            expect(allowedPatientIds.has('p1')).toBe(true);
            expect(allowedPatientIds.has('p2')).toBe(true);
            expect(allowedPatientIds.has('p3')).toBe(false);
        });

        it('removes patient ids that have no connection type', () => {
            const allowedPatientIds = new Set(['p1', 'p2']);
            const patientIdToConnectionTypeMap = new Map([['p1', 'proa']]);
            const allowedConnectionTypesList = ['proa'];

            dataSharingManager.filterPatientsByConnectionType({
                allowedPatientIds,
                patientIdToConnectionTypeMap,
                allowedConnectionTypesList
            });

            expect(allowedPatientIds.has('p1')).toBe(true);
            expect(allowedPatientIds.has('p2')).toBe(false);
        });

        it('handles empty allowedPatientIds set', () => {
            const allowedPatientIds = new Set();
            const patientIdToConnectionTypeMap = new Map();
            const allowedConnectionTypesList = ['proa'];

            dataSharingManager.filterPatientsByConnectionType({
                allowedPatientIds,
                patientIdToConnectionTypeMap,
                allowedConnectionTypesList
            });

            expect(allowedPatientIds.size).toBe(0);
        });
    });

    describe('validatePatientIdsAsync', () => {
        it('returns true when no duplicates exist', async () => {
            const patientsList = [
                { id: 'p1', _sourceId: 'p1', _uuid: 'uuid-1' }
            ];
            const patientReferences = [{ id: 'uuid-1', sourceAssigningAuthority: null }];

            const result = await dataSharingManager.validatePatientIdsAsync({ patientsList, patientReferences });
            expect(result).toBe(true);
        });

        it('throws when duplicates exist', async () => {
            const patientsList = [
                { id: 'p1', _sourceId: 'p1', _uuid: 'uuid-1' },
                { id: 'p2', _sourceId: 'p1', _uuid: 'uuid-2' }
            ];
            const patientReferences = [{ id: 'p1', sourceAssigningAuthority: null }];

            await expect(dataSharingManager.validatePatientIdsAsync({ patientsList, patientReferences }))
                .rejects.toThrow('Multiple Patient Resources');
        });
    });

    describe('getPatientIDToConnectionTypeMap', () => {
        it('returns map with connection types from patient meta.security', async () => {
            const patientsList = [
                {
                    _uuid: 'uuid-1',
                    meta: {
                        security: [
                            { system: 'https://www.icanbwell.com/connectionType', code: 'proa' },
                            { system: 'https://www.icanbwell.com/owner', code: 'client-a' }
                        ]
                    }
                },
                {
                    _uuid: 'uuid-2',
                    meta: { security: [{ system: 'https://www.icanbwell.com/owner', code: 'client-b' }] }
                }
            ];

            const result = await dataSharingManager.getPatientIDToConnectionTypeMap({ patientsList });
            expect(result.get('uuid-1')).toBe('proa');
            expect(result.has('uuid-2')).toBe(false);
        });

        it('handles empty patients list', async () => {
            const result = await dataSharingManager.getPatientIDToConnectionTypeMap({ patientsList: [] });
            expect(result.size).toBe(0);
        });
    });

    describe('updateQueryForDelegatedAccessSensitiveData', () => {
        it('returns impossible query when no consent is found (filteringRules is null)', async () => {
            mockDelegatedAccessRulesManager.getFilteringRulesAsync = jest.fn().mockResolvedValue({
                filteringRules: null
            });

            const result = await dataSharingManager.updateQueryForDelegatedAccessSensitiveData({
                base_version: '4_0_0',
                query: { resourceType: 'Observation' },
                actor: { reference: 'Patient/p1' },
                personIdFromJwtToken: 'person-1'
            });

            expect(result).toEqual({ _uuid: '__invalid__' });
        });

        it('adds sensitive data exclusion filter with denied categories plus unclassified', async () => {
            mockDelegatedAccessRulesManager.getFilteringRulesAsync = jest.fn().mockResolvedValue({
                filteringRules: {
                    consentId: 'consent-1',
                    deniedSensitiveCategories: ['mental-health', 'substance-abuse']
                }
            });

            const query = { resourceType: 'Observation' };
            const result = await dataSharingManager.updateQueryForDelegatedAccessSensitiveData({
                base_version: '4_0_0',
                query,
                actor: { reference: 'Patient/p1' },
                personIdFromJwtToken: 'person-1'
            });

            // Should be a simplified $and query with exclusion filter
            expect(JSON.stringify(result)).toContain('mental-health');
            expect(JSON.stringify(result)).toContain('substance-abuse');
            expect(JSON.stringify(result)).toContain('unclassified');
        });

        it('adds only unclassified when deniedSensitiveCategories is empty', async () => {
            mockDelegatedAccessRulesManager.getFilteringRulesAsync = jest.fn().mockResolvedValue({
                filteringRules: {
                    consentId: 'consent-1',
                    deniedSensitiveCategories: []
                }
            });

            const query = { resourceType: 'Observation' };
            const result = await dataSharingManager.updateQueryForDelegatedAccessSensitiveData({
                base_version: '4_0_0',
                query,
                actor: { reference: 'Patient/p1' },
                personIdFromJwtToken: 'person-1'
            });

            expect(JSON.stringify(result)).toContain('unclassified');
        });
    });

    describe('getResourceReferencesFromFilter', () => {
        it('returns patient references from parsedArgs', () => {
            const mockParsedArgs = Object.create(ParsedArgs.prototype);
            mockParsedArgs.parsedArgItems = [
                {
                    queryParameter: 'patient',
                    queryParameterValue: { values: ['Patient/p1'] },
                    references: [{ resourceType: 'Patient', id: 'p1', sourceAssigningAuthority: null }],
                    modifiers: []
                }
            ];

            const result = dataSharingManager.getResourceReferencesFromFilter('Patient', mockParsedArgs);
            expect(result).toEqual([{ resourceType: 'Patient', id: 'p1', sourceAssigningAuthority: null }]);
        });

        it('skips references with :not modifier', () => {
            const mockParsedArgs = Object.create(ParsedArgs.prototype);
            mockParsedArgs.parsedArgItems = [
                {
                    queryParameter: 'patient',
                    queryParameterValue: { values: ['Patient/p1'] },
                    references: [{ resourceType: 'Patient', id: 'p1', sourceAssigningAuthority: null }],
                    modifiers: ['not']
                }
            ];

            const result = dataSharingManager.getResourceReferencesFromFilter('Patient', mockParsedArgs);
            expect(result).toEqual([]);
        });

        it('includes _id parameters for Patient resourceType', () => {
            const mockParsedArgs = Object.create(ParsedArgs.prototype);
            mockParsedArgs.parsedArgItems = [
                {
                    queryParameter: '_id',
                    queryParameterValue: { values: ['p1'] },
                    references: [],
                    modifiers: []
                }
            ];

            const result = dataSharingManager.getResourceReferencesFromFilter('Patient', mockParsedArgs);
            expect(result.length).toBe(1);
            expect(result[0].id).toBe('p1');
            expect(result[0].resourceType).toBe('Patient');
        });
    });
});
