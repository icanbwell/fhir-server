'use strict';

/**
 * Unit tests for SearchManager
 *
 * Top 3 largest methods:
 * 1. constructQueryAsync (lines 199-358)
 * 2. getCursorForQueryAsync (lines 376-548)
 * 3. streamResourcesFromCursorAsync (lines 915-1063)
 */

const { describe, beforeEach, afterEach, it, test, expect, jest } = require('@jest/globals');

const { SearchManager } = require('../../../../operations/search/searchManager');
const { DatabaseQueryFactory } = require('../../../../dataLayer/databaseQueryFactory');
const { ResourceLocatorFactory } = require('../../../../operations/common/resourceLocatorFactory');
const { SecurityTagManager } = require('../../../../operations/common/securityTagManager');
const { ResourcePreparer } = require('../../../../operations/common/resourcePreparer');
const { IndexHinter } = require('../../../../indexes/indexHinter');
const { R4SearchQueryCreator } = require('../../../../operations/query/r4');
const { ConfigManager } = require('../../../../utils/configManager');
const { QueryRewriterManager } = require('../../../../queryRewriters/queryRewriterManager');
const { ScopesManager } = require('../../../../operations/security/scopesManager');
const { DatabaseAttachmentManager } = require('../../../../dataLayer/databaseAttachmentManager');
const { Base64DataManager } = require('../../../../dataLayer/base64DataManager');
const { FhirResourceWriterFactory } = require('../../../../operations/streaming/resourceWriters/fhirResourceWriterFactory');
const { DataSharingManager } = require('../../../../operations/search/dataSharingManager');
const { SearchQueryBuilder } = require('../../../../operations/search/searchQueryBuilder');
const { PatientScopeManager } = require('../../../../operations/security/patientScopeManager');
const { PatientQueryCreator } = require('../../../../operations/common/patientQueryCreator');
const { SearchParametersManager } = require('../../../../searchParameters/searchParametersManager');
const { SearchParameterDefinition } = require('../../../../searchParameters/searchParameterTypes');
const { ClinicalNoteSearchClient } = require('../../../../utils/clinicalNoteSearchClient');
const { ParsedArgs } = require('../../../../operations/query/parsedArgs');
const { ParsedArgsItem } = require('../../../../operations/query/parsedArgsItem');
const { QueryParameterValue } = require('../../../../operations/query/queryParameterValue');
const { ExternalTimeoutError } = require('../../../../utils/httpErrors');

jest.mock('../../../../operations/common/logging', () => ({
    logError: jest.fn(),
    logInfo: jest.fn(),
    logDebug: jest.fn(),
    logWarn: jest.fn()
}));

jest.mock('../../../../operations/common/systemEventLogging', () => ({
    logTraceSystemEventAsync: jest.fn(),
    logSystemEventAsync: jest.fn()
}));

describe('SearchManager', () => {
    let searchManager;
    let mockDatabaseQueryFactory;
    let mockResourceLocatorFactory;
    let mockSecurityTagManager;
    let mockResourcePreparer;
    let mockIndexHinter;
    let mockR4SearchQueryCreator;
    let mockConfigManager;
    let mockQueryRewriterManager;
    let mockScopesManager;
    let mockDatabaseAttachmentManager;
    let mockBase64DataManager;
    let mockFhirResourceWriterFactory;
    let mockDataSharingManager;
    let mockSearchQueryBuilder;
    let mockPatientScopeManager;
    let mockPatientQueryCreator;
    let mockSearchParametersManager;
    let mockClinicalNoteSearchClient;

    beforeEach(() => {
        mockDatabaseQueryFactory = Object.create(DatabaseQueryFactory.prototype);
        mockResourceLocatorFactory = Object.create(ResourceLocatorFactory.prototype);
        mockSecurityTagManager = Object.create(SecurityTagManager.prototype);
        mockResourcePreparer = Object.create(ResourcePreparer.prototype);
        mockIndexHinter = Object.create(IndexHinter.prototype);
        mockR4SearchQueryCreator = Object.create(R4SearchQueryCreator.prototype);
        mockConfigManager = Object.create(ConfigManager.prototype);
        Object.defineProperty(mockConfigManager, 'enableConsentedProaDataAccess', { value: false, writable: true, configurable: true });
        Object.defineProperty(mockConfigManager, 'doNotRequirePersonOrPatientIdForPatientScope', { value: false, writable: true, configurable: true });
        Object.defineProperty(mockConfigManager, 'requiredFiltersForAuditEvent', { value: null, writable: true, configurable: true });
        Object.defineProperty(mockConfigManager, 'auditEventMaxRangePeriod', { value: 30, writable: true, configurable: true });
        Object.defineProperty(mockConfigManager, 'defaultSortId', { value: '_uuid', writable: true, configurable: true });
        Object.defineProperty(mockConfigManager, 'useAccessIndex', { value: false, writable: true, configurable: true });
        Object.defineProperty(mockConfigManager, 'mongoTimeout', { value: 30000, writable: true, configurable: true });
        Object.defineProperty(mockConfigManager, 'streamingHighWaterMark', { value: 100, writable: true, configurable: true });
        mockQueryRewriterManager = Object.create(QueryRewriterManager.prototype);
        mockScopesManager = Object.create(ScopesManager.prototype);
        mockDatabaseAttachmentManager = Object.create(DatabaseAttachmentManager.prototype);
        mockBase64DataManager = Object.create(Base64DataManager.prototype);
        mockFhirResourceWriterFactory = Object.create(FhirResourceWriterFactory.prototype);
        mockDataSharingManager = Object.create(DataSharingManager.prototype);
        mockSearchQueryBuilder = Object.create(SearchQueryBuilder.prototype);
        mockPatientScopeManager = Object.create(PatientScopeManager.prototype);
        mockPatientQueryCreator = Object.create(PatientQueryCreator.prototype);
        mockSearchParametersManager = Object.create(SearchParametersManager.prototype);
        mockSearchParametersManager.allowedFieldsByResourceType = new Map();
        mockClinicalNoteSearchClient = Object.create(ClinicalNoteSearchClient.prototype);

        searchManager = new SearchManager({
            databaseQueryFactory: mockDatabaseQueryFactory,
            resourceLocatorFactory: mockResourceLocatorFactory,
            securityTagManager: mockSecurityTagManager,
            resourcePreparer: mockResourcePreparer,
            indexHinter: mockIndexHinter,
            r4SearchQueryCreator: mockR4SearchQueryCreator,
            configManager: mockConfigManager,
            queryRewriterManager: mockQueryRewriterManager,
            scopesManager: mockScopesManager,
            databaseAttachmentManager: mockDatabaseAttachmentManager,
            base64DataManager: mockBase64DataManager,
            fhirResourceWriterFactory: mockFhirResourceWriterFactory,
            dataSharingManager: mockDataSharingManager,
            searchQueryBuilder: mockSearchQueryBuilder,
            patientScopeManager: mockPatientScopeManager,
            patientQueryCreator: mockPatientQueryCreator,
            searchParametersManager: mockSearchParametersManager,
            clinicalNoteSearchClient: mockClinicalNoteSearchClient
        });
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    describe('constructQueryAsync', () => {
        let mockParsedArgs;

        beforeEach(() => {
            mockParsedArgs = {
                base_version: '4_0_0', _elements: null, _sort: null, _count: null, id: null,
                get: jest.fn().mockReturnValue(undefined)
            };
            mockScopesManager.isAccessAllowedByPatientScopes = jest.fn().mockReturnValue(false);
            mockSecurityTagManager.getSecurityTagsFromScope = jest.fn().mockReturnValue(['client-abc']);
            mockSecurityTagManager.getQueryWithSecurityTags = jest.fn().mockReturnValue({ 'meta.security': { $elemMatch: { code: 'client-abc' } } });
            mockSearchQueryBuilder.buildSearchQueryBasedOnVersion = jest.fn().mockReturnValue({
                query: { resourceType: 'Observation' }, columns: new Set(['_uuid'])
            });
            mockConfigManager.enableConsentedProaDataAccess = false;
            mockQueryRewriterManager.rewriteQueryAsync = jest.fn().mockImplementation(async ({ query, columns }) => ({ query, columns }));
        });

        it('builds query with security tags when not patient scope', async () => {
            const result = await searchManager.constructQueryAsync({
                user: 'user-1', scope: 'system/Observation.read', isUser: false, userType: null,
                resourceType: 'Observation', useAccessIndex: false, personIdFromJwtToken: null,
                requestId: 'req-1', parsedArgs: mockParsedArgs, useHistoryTable: false, operation: 'READ', accessRequested: 'read'
            });
            expect(result.base_version).toBe('4_0_0');
            expect(result.query).toBeDefined();
            expect(mockSecurityTagManager.getQueryWithSecurityTags).toHaveBeenCalled();
        });

        it('calls dataSharingManager when consent is enabled', async () => {
            mockConfigManager.enableConsentedProaDataAccess = true;
            mockDataSharingManager.updateQueryConsideringDataSharing = jest.fn().mockResolvedValue({ $or: [{ q: 1 }, { q: 2 }] });

            await searchManager.constructQueryAsync({
                user: 'user-1', scope: 'system/Observation.read', isUser: false, userType: null,
                resourceType: 'Observation', useAccessIndex: false, personIdFromJwtToken: null,
                requestId: 'req-1', parsedArgs: mockParsedArgs, useHistoryTable: false, operation: 'READ',
                accessRequested: 'read', allowConsentedProaDataAccess: true
            });
            expect(mockDataSharingManager.updateQueryConsideringDataSharing).toHaveBeenCalled();
        });

        it('returns invalid query when patient scope has no patient ids', async () => {
            mockScopesManager.isAccessAllowedByPatientScopes = jest.fn().mockReturnValue(true);
            mockPatientScopeManager.getPatientIdsFromScopeAsync = jest.fn().mockResolvedValue(['person-1']);
            mockConfigManager.doNotRequirePersonOrPatientIdForPatientScope = false;

            const result = await searchManager.constructQueryAsync({
                user: 'user-1', scope: 'patient/Observation.read', isUser: true, userType: null,
                resourceType: 'Observation', useAccessIndex: false, personIdFromJwtToken: 'person-1',
                requestId: 'req-1', parsedArgs: mockParsedArgs, useHistoryTable: false, operation: 'READ', accessRequested: 'read'
            });
            expect(result.query).toEqual({ _uuid: '__invalid__' });
        });

        it('applies delegated access for delegatedUser', async () => {
            mockDataSharingManager.patientFilterManager = { canAccessResourceWithPatientScope: jest.fn().mockReturnValue(true) };
            mockDataSharingManager.updateQueryForDelegatedAccessSensitiveData = jest.fn().mockResolvedValue({ $and: [{ q: 1 }] });

            await searchManager.constructQueryAsync({
                user: 'user-1', scope: 'system/Observation.read', isUser: false, userType: 'delegatedUser',
                resourceType: 'Observation', useAccessIndex: false, personIdFromJwtToken: 'person-1',
                requestId: 'req-1', parsedArgs: mockParsedArgs, useHistoryTable: false, operation: 'READ',
                accessRequested: 'read', actor: { reference: 'Patient/p1' }
            });
            expect(mockDataSharingManager.updateQueryForDelegatedAccessSensitiveData).toHaveBeenCalled();
        });

        it('AND-composes the _content candidate-id filter with the security-tag filter -- neither replaces the other', async () => {
            // Security property under test: candidate ids returned by the vector store (an
            // external, unauthorized-by-fhir-server data source) must be re-authorized through the
            // SAME query object that the tenant/access-tag scoping (getQueryWithSecurityTags) also
            // mutates -- not a separate/bypassable branch. We prove this by asserting the final
            // query carries BOTH pieces, AND-composed.
            const contentParsedArgs = new ParsedArgs({ base_version: '4_0_0' });
            contentParsedArgs.add(new ParsedArgsItem({
                queryParameter: '_content',
                queryParameterValue: new QueryParameterValue({ value: 'diabetes', operator: '$and' }),
                modifiers: []
            }));

            Object.defineProperty(mockConfigManager, 'fhirNotesFullTextSearchConfigured', {
                value: true, writable: true, configurable: true
            });
            mockClinicalNoteSearchClient.findMatchingResourceIdsAsync = jest.fn().mockResolvedValue(['abc123', 'def456']);
            mockR4SearchQueryCreator.appendAndQuery = jest.fn().mockImplementation(
                ({ query, andQuery }) => ({ $and: [query, andQuery] })
            );
            // The default beforeEach stub for getQueryWithSecurityTags returns a fixed object
            // without looking at its `query` argument, which is fine for the other tests in this
            // block but would hide the very bug this test exists to catch (the security-tag step
            // silently discarding whatever query it was handed instead of AND-composing with it).
            // Override it here to actually incorporate the incoming query, the way the real
            // SecurityTagManager implementation does.
            mockSecurityTagManager.getQueryWithSecurityTags = jest.fn().mockImplementation(({ query }) => ({
                $and: [query, { 'meta.security': { $elemMatch: { code: 'client-abc' } } }]
            }));

            const result = await searchManager.constructQueryAsync({
                user: 'user-1', scope: 'system/DocumentReference.read', isUser: false, userType: null,
                resourceType: 'DocumentReference', useAccessIndex: false, personIdFromJwtToken: null,
                requestId: 'req-1', parsedArgs: contentParsedArgs, useHistoryTable: false, operation: 'READ',
                accessRequested: 'read'
            });

            expect(mockClinicalNoteSearchClient.findMatchingResourceIdsAsync).toHaveBeenCalledWith({
                resourceType: 'DocumentReference', contentQuery: 'diabetes'
            });
            expect(mockR4SearchQueryCreator.appendAndQuery).toHaveBeenCalledWith({
                query: { resourceType: 'Observation' },
                andQuery: { _sourceId: { $in: ['abc123', 'def456'] } }
            });
            // The security-tag step must have received a query that already carries the
            // _content-derived id filter -- proving both flow through the SAME query object rather
            // than the id filter living on some separate/bypassable branch.
            expect(mockSecurityTagManager.getQueryWithSecurityTags).toHaveBeenCalledWith(
                expect.objectContaining({
                    query: { $and: [{ resourceType: 'Observation' }, { _sourceId: { $in: ['abc123', 'def456'] } }] }
                })
            );
            // Both the _content-derived id filter and the security-tag filter must be present in
            // the final query -- AND-composed, not one clobbering the other.
            // Order is an implementation detail of MongoQuerySimplifier's $and-flattening -- assert
            // membership, not exact array order.
            expect(result.query.$and).toEqual(expect.arrayContaining([
                { _sourceId: { $in: ['abc123', 'def456'] } },
                { 'meta.security': { $elemMatch: { code: 'client-abc' } } }
            ]));
        });

        it('an empty _content candidate list survives MongoQuerySimplifier as __invalid__, never as "no filter, return everything"', async () => {
            // Regression test for a real bug found in review: MongoQuerySimplifier.simplifyFilter
            // (a real, unmocked static utility -- constructQueryAsync always runs it on the final
            // query) deletes {_uuid:{$in:[]}} entirely, along with the now-empty $and clause around
            // it. If buildContentSearchIdFilterAsync's empty-candidate case ever regressed back to
            // returning {_uuid:{$in:[]}} instead of the __invalid__ sentinel, this test would catch
            // it by asserting on constructQueryAsync's actual returned query -- not on
            // buildContentSearchIdFilterAsync's return value in isolation.
            const contentParsedArgs = new ParsedArgs({ base_version: '4_0_0' });
            contentParsedArgs.add(new ParsedArgsItem({
                queryParameter: '_content',
                queryParameterValue: new QueryParameterValue({ value: 'zzzznomatch', operator: '$and' }),
                modifiers: []
            }));

            Object.defineProperty(mockConfigManager, 'fhirNotesFullTextSearchConfigured', {
                value: true, writable: true, configurable: true
            });
            mockClinicalNoteSearchClient.findMatchingResourceIdsAsync = jest.fn().mockResolvedValue([]);
            mockR4SearchQueryCreator.appendAndQuery = jest.fn().mockImplementation(
                ({ query, andQuery }) => ({ $and: [query, andQuery] })
            );
            mockSecurityTagManager.getQueryWithSecurityTags = jest.fn().mockImplementation(({ query }) => ({
                $and: [query, { 'meta.security': { $elemMatch: { code: 'client-abc' } } }]
            }));

            const result = await searchManager.constructQueryAsync({
                user: 'user-1', scope: 'system/DocumentReference.read', isUser: false, userType: null,
                resourceType: 'DocumentReference', useAccessIndex: false, personIdFromJwtToken: null,
                requestId: 'req-1', parsedArgs: contentParsedArgs, useHistoryTable: false, operation: 'READ',
                accessRequested: 'read'
            });

            expect(result.query.$and).toEqual(expect.arrayContaining([{ _uuid: '__invalid__' }]));
            // Never silently degrade to "only the security-tag filter applies" -- that's exactly
            // "no filter, so return everything" for the _content search the caller actually asked
            // for.
            expect(result.query).not.toEqual({ 'meta.security': { $elemMatch: { code: 'client-abc' } } });
        });
    });

    describe('handleCountOption', () => {
        it('sets limit and skip', () => {
            const result = searchManager.handleCountOption({ parsedArgs: { _count: '10', _getpagesoffset: '2' }, options: {}, isStreaming: false });
            expect(result.options.limit).toBe(10);
            expect(result.options.skip).toBe(20);
        });

        it('caps limit at 1000 when not streaming', () => {
            const result = searchManager.handleCountOption({ parsedArgs: { _count: '50000' }, options: {}, isStreaming: false });
            expect(result.options.limit).toBe(1000);
        });

        it('does not cap limit when streaming', () => {
            const result = searchManager.handleCountOption({ parsedArgs: { _count: '50000' }, options: {}, isStreaming: true });
            expect(result.options.limit).toBe(50000);
        });
    });

    describe('handleSortQuery', () => {
        beforeEach(() => {
            mockSearchParametersManager.getSearchParametersForResource = jest.fn(({ resourceType }) => {
                if (resourceType === 'Observation') {
                    return {
                        status: new SearchParameterDefinition({ type: 'token', field: 'status' }),
                        category: new SearchParameterDefinition({ type: 'token', field: 'category' }),
                        date: new SearchParameterDefinition({
                            type: 'date',
                            fields: ['effectiveDateTime', 'effectivePeriod', 'effectiveTiming', 'effectiveInstant']
                        }),
                        patient: new SearchParameterDefinition({ type: 'reference', field: 'subject' })
                    };
                }
                if (resourceType === 'MedicationStatement') {
                    return {
                        effective: new SearchParameterDefinition({
                            type: 'date',
                            fields: ['effectiveDateTime', 'effectivePeriod'],
                            fieldTypesObj: { effectiveDateTime: 'datetime', effectivePeriod: 'period' }
                        })
                    };
                }
                if (resourceType === 'Resource') {
                    return {
                        _id: new SearchParameterDefinition({ type: 'token', field: 'id' }),
                        _lastUpdated: new SearchParameterDefinition({ type: 'date', field: 'meta.lastUpdated' })
                    };
                }
                return undefined;
            });
            mockSearchParametersManager.getFieldNameForSearchParameter = jest.fn((searchResourceType, searchParameterName) => {
                const byResourceType = {
                    Observation: { status: 'status', category: 'category', date: 'effectiveDateTime', patient: 'subject' },
                    MedicationStatement: { effective: 'effectiveDateTime' },
                    Resource: { _id: 'id', _lastUpdated: 'meta.lastUpdated' }
                };
                return byResourceType[searchResourceType]?.[searchParameterName] ??
                    byResourceType.Resource[searchParameterName] ??
                    null;
            });
        });

        it('adds ascending sort for an allowed field', () => {
            const parsedArgs = { get: () => ({ queryParameterValue: { values: ['status'] } }), _sort: 'status' };
            const result = searchManager.handleSortQuery({ parsedArgs, columns: new Set(), options: {}, resourceType: 'Observation' });
            expect(result.options.sort.status).toBe(1);
            expect(result.columns.has('status')).toBe(true);
        });

        it('adds descending sort with - prefix for an allowed field', () => {
            const parsedArgs = { get: () => ({ queryParameterValue: { values: ['-category'] } }), _sort: '-category' };
            const result = searchManager.handleSortQuery({ parsedArgs, columns: new Set(), options: {}, resourceType: 'Observation' });
            expect(result.options.sort.category).toBe(-1);
        });

        it('handles multiple allowed sort properties, including a nested dotted path from the generic Resource bucket', () => {
            const parsedArgs = {
                get: () => ({ queryParameterValue: { values: ['status', '-meta.lastUpdated', 'category'] } }),
                _sort: 'status,-meta.lastUpdated,category'
            };
            const result = searchManager.handleSortQuery({ parsedArgs, columns: new Set(), options: {}, resourceType: 'Observation' });
            expect(result.options.sort.status).toBe(1);
            expect(result.options.sort['meta.lastUpdated']).toBe(-1);
            expect(result.options.sort.category).toBe(1);
        });

        it('drops a sort field that is not in the resource allowlist instead of failing the request', () => {
            const parsedArgs = { get: () => ({ queryParameterValue: { values: ['$$$'] } }), _sort: '$$$' };
            const result = searchManager.handleSortQuery({ parsedArgs, columns: new Set(), options: {}, resourceType: 'Observation' });
            expect(result.options.sort).toStrictEqual({});
            expect(result.columns.has('$$$')).toBe(false);
        });

        it('drops only the invalid field when mixed with valid ones', () => {
            const parsedArgs = { get: () => ({ queryParameterValue: { values: ['status', '$$$'] } }), _sort: 'status,$$$' };
            const result = searchManager.handleSortQuery({ parsedArgs, columns: new Set(), options: {}, resourceType: 'Observation' });
            expect(result.options.sort).toStrictEqual({ status: 1 });
        });

        it('always allows the configured default sort tie-breaker field, even though it has no search-parameter definition', () => {
            const parsedArgs = { get: () => ({ queryParameterValue: { values: ['_uuid'] } }), _sort: '_uuid' };
            const result = searchManager.handleSortQuery({ parsedArgs, columns: new Set(), options: {}, resourceType: 'Observation' });
            expect(result.options.sort._uuid).toBe(1);
        });

        it('resolves a search-parameter code to its underlying field when they differ (_sort=-date on Observation)', () => {
            const parsedArgs = { get: () => ({ queryParameterValue: { values: ['-date'] } }), _sort: '-date' };
            const result = searchManager.handleSortQuery({ parsedArgs, columns: new Set(), options: {}, resourceType: 'Observation' });
            expect(result.options.sort.effectiveDateTime).toBe(-1);
            expect(result.options.sort.date).toBeUndefined();
            expect(result.columns.has('effectiveDateTime')).toBe(true);
        });

        it('resolves the _lastUpdated search-parameter code (Resource bucket) to meta.lastUpdated', () => {
            const parsedArgs = { get: () => ({ queryParameterValue: { values: ['_lastUpdated'] } }), _sort: '_lastUpdated' };
            const result = searchManager.handleSortQuery({ parsedArgs, columns: new Set(), options: {}, resourceType: 'Observation' });
            expect(result.options.sort['meta.lastUpdated']).toBe(1);
            expect(result.options.sort._lastUpdated).toBeUndefined();
        });

        it('resolves a reference-type search-parameter code to its field (patient -> subject)', () => {
            const parsedArgs = { get: () => ({ queryParameterValue: { values: ['patient'] } }), _sort: 'patient' };
            const result = searchManager.handleSortQuery({ parsedArgs, columns: new Set(), options: {}, resourceType: 'Observation' });
            expect(result.options.sort.subject).toBe(1);
            expect(result.options.sort.patient).toBeUndefined();
        });

        it('resolves effectivePeriod.end via the generic period-type fallback, with no dedicated search parameter declaring that dotted path (matches real client traffic)', () => {
            const parsedArgs = { get: () => ({ queryParameterValue: { values: ['-effectivePeriod.end'] } }), _sort: '-effectivePeriod.end' };
            const result = searchManager.handleSortQuery({ parsedArgs, columns: new Set(), options: {}, resourceType: 'MedicationStatement' });
            expect(result.options.sort['effectivePeriod.end']).toBe(-1);
            expect(result.columns.has('effectivePeriod.end')).toBe(true);
        });

        it('resolves effectivePeriod.start via the generic period-type fallback the same way', () => {
            const parsedArgs = { get: () => ({ queryParameterValue: { values: ['effectivePeriod.start'] } }), _sort: 'effectivePeriod.start' };
            const result = searchManager.handleSortQuery({ parsedArgs, columns: new Set(), options: {}, resourceType: 'MedicationStatement' });
            expect(result.options.sort['effectivePeriod.start']).toBe(1);
        });

        it('drops a boundary other than start/end on a period-typed field (effectivePeriod.middle is not a real boundary)', () => {
            const parsedArgs = { get: () => ({ queryParameterValue: { values: ['effectivePeriod.middle'] } }), _sort: 'effectivePeriod.middle' };
            const result = searchManager.handleSortQuery({ parsedArgs, columns: new Set(), options: {}, resourceType: 'MedicationStatement' });
            expect(result.options.sort).toStrictEqual({});
        });

        it('drops a .start/.end suffix on a field that is declared but not typed as a period (Observation.effectivePeriod has no fieldTypesObj in this fixture, unlike MedicationStatement)', () => {
            const parsedArgs = { get: () => ({ queryParameterValue: { values: ['effectivePeriod.end'] } }), _sort: 'effectivePeriod.end' };
            const result = searchManager.handleSortQuery({ parsedArgs, columns: new Set(), options: {}, resourceType: 'Observation' });
            expect(result.options.sort).toStrictEqual({});
        });

        it('drops a dotted value whose base field was never declared by any search parameter', () => {
            const parsedArgs = { get: () => ({ queryParameterValue: { values: ['bogus.field'] } }), _sort: 'bogus.field' };
            const result = searchManager.handleSortQuery({ parsedArgs, columns: new Set(), options: {}, resourceType: 'MedicationStatement' });
            expect(result.options.sort).toStrictEqual({});
        });

        it('drops an injection-shaped value ($-prefixed) since it was never declared as an allowed field', () => {
            const parsedArgs = { get: () => ({ queryParameterValue: { values: ['effectivePeriod.$where'] } }), _sort: 'effectivePeriod.$where' };
            const result = searchManager.handleSortQuery({ parsedArgs, columns: new Set(), options: {}, resourceType: 'MedicationStatement' });
            expect(result.options.sort).toStrictEqual({});
        });

        it('drops the _id search-parameter code since id resolution to sourceId/uuid is not yet decided', () => {
            const parsedArgs = { get: () => ({ queryParameterValue: { values: ['_id'] } }), _sort: '_id' };
            const result = searchManager.handleSortQuery({ parsedArgs, columns: new Set(), options: {}, resourceType: 'Observation' });
            expect(result.options.sort).toStrictEqual({});
            expect(result.columns.has('id')).toBe(false);
        });

        it('drops the raw id field too, since it resolves to the same ambiguous field as _id', () => {
            const parsedArgs = { get: () => ({ queryParameterValue: { values: ['-id'] } }), _sort: '-id' };
            const result = searchManager.handleSortQuery({ parsedArgs, columns: new Set(), options: {}, resourceType: 'Observation' });
            expect(result.options.sort).toStrictEqual({});
        });

        describe('CUSTOM_SORT_FIELDS temporary allowlist', () => {
            it.each([
                ['VerificationResult', 'statusDate'],
                ['Person', 'active'],
                ['Coverage', 'period.start'],
                ['Coverage', 'period.end'],
                ['ExplanationOfBenefit', 'billablePeriod.start'],
                ['ExplanationOfBenefit', 'billablePeriod.end'],
                ['CarePlan', 'created'],
                ['Questionnaire', '_sourceId'],
                ['AllergyIntolerance', 'onsetDateTime'],
                ['AllergyIntolerance', 'onsetPeriod.start'],
                ['AllergyIntolerance', 'onsetPeriod.end'],
                ['Procedure', 'encounter.period.start'],
                ['Procedure', 'encounter.period.end']
            ])('resolves %s\'s %s via the temporary custom-sort-field allowlist, with no search parameter declaring it', (resourceType, sortCode) => {
                const parsedArgs = { get: () => ({ queryParameterValue: { values: [sortCode] } }), _sort: sortCode };
                const result = searchManager.handleSortQuery({ parsedArgs, columns: new Set(), options: {}, resourceType });
                expect(result.options.sort[sortCode]).toBe(1);
                expect(result.columns.has(sortCode)).toBe(true);
            });

            it('honors the - prefix for a custom sort field', () => {
                const parsedArgs = { get: () => ({ queryParameterValue: { values: ['-statusDate'] } }), _sort: '-statusDate' };
                const result = searchManager.handleSortQuery({ parsedArgs, columns: new Set(), options: {}, resourceType: 'VerificationResult' });
                expect(result.options.sort.statusDate).toBe(-1);
            });

            it('does not allow a custom sort field for a resourceType it is not allowlisted for', () => {
                const parsedArgs = { get: () => ({ queryParameterValue: { values: ['statusDate'] } }), _sort: 'statusDate' };
                const result = searchManager.handleSortQuery({ parsedArgs, columns: new Set(), options: {}, resourceType: 'Observation' });
                expect(result.options.sort).toStrictEqual({});
            });
        });
    });

    describe('setDefaultLimit', () => {
        it('sets DB_SEARCH_LIMIT when no id and no elements', () => {
            const options = {};
            searchManager.setDefaultLimit({ parsedArgs: { id: null, _elements: null, _isGraphQLRequest: false }, options });
            expect(options.limit).toBe(100);
        });

        it('sets DB_SEARCH_LIMIT_FOR_IDS when id is present', () => {
            const options = {};
            searchManager.setDefaultLimit({ parsedArgs: { id: 'some-id', _elements: null }, options });
            expect(options.limit).toBe(1000);
        });
    });

    describe('setCursorBatchSize', () => {
        it('sets batch size from parsedArgs', () => {
            const cursorQuery = { batchSize: jest.fn().mockReturnThis() };
            const result = searchManager.setCursorBatchSize({ parsedArgs: { _cursorBatchSize: '500' }, cursorQuery });
            expect(result.cursorBatchSize).toBe(500);
            expect(cursorQuery.batchSize).toHaveBeenCalledWith({ size: 500 });
        });

        it('does not call batchSize when value is 0', () => {
            const cursorQuery = { batchSize: jest.fn().mockReturnThis() };
            const result = searchManager.setCursorBatchSize({ parsedArgs: { _cursorBatchSize: '0' }, cursorQuery });
            expect(result.cursorBatchSize).toBe(0);
            expect(cursorQuery.batchSize).not.toHaveBeenCalled();
        });
    });

    describe('setIndexHint', () => {
        it('applies index hint when found', () => {
            mockIndexHinter.findIndexForFields = jest.fn().mockReturnValue('idx_security');
            const cursor = { hint: jest.fn().mockReturnThis() };
            const result = searchManager.setIndexHint({ mongoCollectionName: 'Obs_4_0_0', columns: new Set(['a']), cursor, user: 'u', indexName: undefined });
            expect(result.indexHint).toBe('idx_security');
            expect(cursor.hint).toHaveBeenCalled();
        });

        it('returns null hint when no index found', () => {
            mockIndexHinter.findIndexForFields = jest.fn().mockReturnValue(null);
            const cursor = { hint: jest.fn().mockReturnThis() };
            const result = searchManager.setIndexHint({ mongoCollectionName: 'Obs_4_0_0', columns: new Set(['a']), cursor, user: 'u', indexName: undefined });
            expect(result.indexHint).toBeNull();
            expect(cursor.hint).not.toHaveBeenCalled();
        });
    });

    describe('validateAuditEventQueryParameters', () => {
        beforeEach(() => {
            mockConfigManager.requiredFiltersForAuditEvent = ['date'];
            mockConfigManager.auditEventMaxRangePeriod = 240;
        });

        it('throws when required filter is missing', () => {
            expect(() => searchManager.validateAuditEventQueryParameters({})).toThrow('is required to query AuditEvent');
        });

        it('throws when only gt provided without lt', () => {
            expect(() => searchManager.validateAuditEventQueryParameters({ date: ['ge2024-01-01'] }))
                .toThrow('Atleast two operations');
        });

        it('throws when date range exceeds max', () => {
            expect(() => searchManager.validateAuditEventQueryParameters({ date: ['ge2023-01-01', 'le2024-12-31'] }))
                .toThrow('should not be greater than');
        });

        it('passes for valid date range', () => {
            expect(() => searchManager.validateAuditEventQueryParameters({ date: ['ge2024-01-01', 'le2024-01-07'] })).not.toThrow();
        });
    });

    describe('handleGetTotalsAsync', () => {
        it('returns count from database', async () => {
            mockDatabaseQueryFactory.createQuery = jest.fn().mockReturnValue({ exactDocumentCountAsync: jest.fn().mockResolvedValue(42) });
            const result = await searchManager.handleGetTotalsAsync({ resourceType: 'Observation', base_version: '4_0_0', query: {}, maxMongoTimeMS: 30000, extraInfo: {} });
            expect(result).toBe(42);
        });

        it('throws RethrownError on failure', async () => {
            mockDatabaseQueryFactory.createQuery = jest.fn().mockReturnValue({ exactDocumentCountAsync: jest.fn().mockRejectedValue(new Error('timeout')) });
            await expect(searchManager.handleGetTotalsAsync({ resourceType: 'Observation', base_version: '4_0_0', query: {}, maxMongoTimeMS: 30000, extraInfo: {} }))
                .rejects.toThrow('Error getting totals');
        });
    });
});

function makeParsedArgsWithContent (value) {
    const parsedArgs = new ParsedArgs({ base_version: '4_0_0' });
    parsedArgs.add(new ParsedArgsItem({
        queryParameter: '_content',
        queryParameterValue: new QueryParameterValue({ value, operator: '$and' }),
        modifiers: []
    }));
    return parsedArgs;
}

// NOTE: ServerError's constructor (src/middleware/fhir/utils/server.error.js) calls
// `Object.setPrototypeOf(this, ServerError.prototype)` unconditionally, resetting the prototype
// chain on every subclass instance (including BadRequestError/ExternalTimeoutError) back to
// ServerError.prototype. `instanceof`/`toBeInstanceOf` against any httpErrors.js class is
// therefore always false, for this pre-existing, unrelated reason -- already documented in
// src/tests/unit/utils/httpErrors.test.js and
// src/tests/unit/operations/query/filters/composite.test.js. Follow that same established
// convention here: assert on `statusCode` instead of `instanceof`.
async function expectRejectionWithStatusCode (promise, statusCode) {
    let thrownError;
    try {
        await promise;
        throw new Error(`expected promise to reject with statusCode ${statusCode}, but it resolved`);
    } catch (e) {
        thrownError = e;
    }
    expect(thrownError.statusCode).toBe(statusCode);
}

// Minimal SearchManager instantiation helper: fill every other constructor dependency with a
// harmless Object.create(...)-based stub, since buildContentSearchIdFilterAsync only touches
// configManager and clinicalNoteSearchClient. Every SearchManager constructor dependency is
// guarded by assertTypeEquals (instanceof check), so plain `{}` stubs (as a literal reading of
// this file's own test-code template would suggest) don't satisfy the constructor -- each stub
// must be Object.create(SomeClass.prototype), matching this file's outer describe('SearchManager')
// beforeEach convention. configManager overrides use Object.defineProperty because ConfigManager
// exposes its config flags (e.g. fhirNotesFullTextSearchConfigured) as class getters, which a
// plain property assignment can't shadow.
function makeSearchManager ({ configManager: configManagerOverrides, clinicalNoteSearchClient: clinicalNoteSearchClientOverrides }) {
    const configManager = Object.create(ConfigManager.prototype);
    for (const [key, value] of Object.entries(configManagerOverrides)) {
        Object.defineProperty(configManager, key, { value, writable: true, configurable: true });
    }
    const clinicalNoteSearchClient = Object.assign(
        Object.create(ClinicalNoteSearchClient.prototype), clinicalNoteSearchClientOverrides
    );
    return new SearchManager({
        databaseQueryFactory: Object.create(DatabaseQueryFactory.prototype),
        resourceLocatorFactory: Object.create(ResourceLocatorFactory.prototype),
        securityTagManager: Object.create(SecurityTagManager.prototype),
        resourcePreparer: Object.create(ResourcePreparer.prototype),
        indexHinter: Object.create(IndexHinter.prototype),
        r4SearchQueryCreator: Object.create(R4SearchQueryCreator.prototype),
        configManager,
        queryRewriterManager: Object.create(QueryRewriterManager.prototype),
        scopesManager: Object.create(ScopesManager.prototype),
        databaseAttachmentManager: Object.create(DatabaseAttachmentManager.prototype),
        base64DataManager: Object.create(Base64DataManager.prototype),
        fhirResourceWriterFactory: Object.create(FhirResourceWriterFactory.prototype),
        dataSharingManager: Object.create(DataSharingManager.prototype),
        searchQueryBuilder: Object.create(SearchQueryBuilder.prototype),
        patientScopeManager: Object.create(PatientScopeManager.prototype),
        patientQueryCreator: Object.create(PatientQueryCreator.prototype),
        searchParametersManager: Object.create(SearchParametersManager.prototype),
        clinicalNoteSearchClient
    });
}

describe('SearchManager.buildContentSearchIdFilterAsync', () => {
    test('returns null when _content is not present', async () => {
        const searchManager = makeSearchManager({
            configManager: { fhirNotesFullTextSearchConfigured: true },
            clinicalNoteSearchClient: {}
        });
        const result = await searchManager.buildContentSearchIdFilterAsync({
            resourceType: 'DocumentReference',
            parsedArgs: new ParsedArgs({ base_version: '4_0_0' }),
            operation: 'READ'
        });
        expect(result).toBeNull();
    });

    test('throws BadRequestError for an unsupported resourceType', async () => {
        const searchManager = makeSearchManager({
            configManager: { fhirNotesFullTextSearchConfigured: true },
            clinicalNoteSearchClient: {}
        });
        await expectRejectionWithStatusCode(searchManager.buildContentSearchIdFilterAsync({
            resourceType: 'Condition',
            parsedArgs: makeParsedArgsWithContent('diabetes'),
            operation: 'READ'
        }), 400);
    });

    test('ignores _content silently (returns null) when the feature is not configured', async () => {
        const searchManager = makeSearchManager({
            configManager: { fhirNotesFullTextSearchConfigured: false },
            clinicalNoteSearchClient: { findMatchingResourceIdsAsync: async () => { throw new Error('should not be called'); } }
        });
        const result = await searchManager.buildContentSearchIdFilterAsync({
            resourceType: 'DocumentReference',
            parsedArgs: makeParsedArgsWithContent('diabetes'),
            operation: 'READ'
        });
        expect(result).toBeNull();
    });

    test('ignores _content silently (returns null) when the feature flag is off, even for an unsupported resourceType', async () => {
        const searchManager = makeSearchManager({
            configManager: { fhirNotesFullTextSearchConfigured: false },
            clinicalNoteSearchClient: { findMatchingResourceIdsAsync: async () => { throw new Error('should not be called'); } }
        });
        const result = await searchManager.buildContentSearchIdFilterAsync({
            resourceType: 'Condition',
            parsedArgs: makeParsedArgsWithContent('diabetes'),
            operation: 'READ'
        });
        expect(result).toBeNull();
    });

    test.each(['WRITE', 'write', 'DELETE', 'delete'])(
        'ignores _content silently (returns null) for a %s operation, never gating a write/delete by an external index',
        async (operation) => {
            const searchManager = makeSearchManager({
                configManager: { fhirNotesFullTextSearchConfigured: true },
                clinicalNoteSearchClient: { findMatchingResourceIdsAsync: async () => { throw new Error('should not be called'); } }
            });
            const result = await searchManager.buildContentSearchIdFilterAsync({
                resourceType: 'DocumentReference',
                parsedArgs: makeParsedArgsWithContent('diabetes'),
                operation
            });
            expect(result).toBeNull();
        }
    );

    test('ignores _content silently (returns null) on a history query, since FilterById cannot target the history field mapping', async () => {
        const searchManager = makeSearchManager({
            configManager: { fhirNotesFullTextSearchConfigured: true },
            clinicalNoteSearchClient: { findMatchingResourceIdsAsync: async () => { throw new Error('should not be called'); } }
        });
        const result = await searchManager.buildContentSearchIdFilterAsync({
            resourceType: 'DocumentReference',
            parsedArgs: makeParsedArgsWithContent('diabetes'),
            operation: 'READ',
            useHistoryTable: true
        });
        expect(result).toBeNull();
    });

    test('returns an _uuid $in filter built from uuid-shaped candidate ids', async () => {
        // Candidate ids that are actually uuid-shaped (matching the plan's stated contract) must
        // route through FilterById to the _uuid field, not _sourceId or $or.
        const clinicalNoteSearchClient = {
            findMatchingResourceIdsAsync: async () => [
                '123e4567-e89b-12d3-a456-426614174000',
                '223e4567-e89b-12d3-a456-426614174000'
            ]
        };
        const searchManager = makeSearchManager({
            configManager: { fhirNotesFullTextSearchConfigured: true },
            clinicalNoteSearchClient
        });
        const result = await searchManager.buildContentSearchIdFilterAsync({
            resourceType: 'DocumentReference',
            parsedArgs: makeParsedArgsWithContent('diabetes'),
            operation: 'READ'
        });
        expect(result).toEqual({
            _uuid: {
                $in: ['123e4567-e89b-12d3-a456-426614174000', '223e4567-e89b-12d3-a456-426614174000']
            }
        });
    });

    test('returns a _sourceId $in filter for non-uuid-shaped candidate ids (intentional fallback, not a bug)', async () => {
        // FilterById.getListFilter (via IdParser.parse + isUuid) routes any candidate id that
        // isn't uuid-shaped to _sourceId instead of _uuid. ClinicalNoteSearchClient now resolves
        // candidates to _uuid itself in the normal case; this exercises the fallback path in case
        // a candidate somehow isn't uuid-shaped.
        const clinicalNoteSearchClient = {
            findMatchingResourceIdsAsync: async () => ['abc123', 'def456']
        };
        const searchManager = makeSearchManager({
            configManager: { fhirNotesFullTextSearchConfigured: true },
            clinicalNoteSearchClient
        });
        const result = await searchManager.buildContentSearchIdFilterAsync({
            resourceType: 'DocumentReference',
            parsedArgs: makeParsedArgsWithContent('diabetes'),
            operation: 'READ'
        });
        expect(result).toEqual({ _sourceId: { $in: ['abc123', 'def456'] } });
    });

    test('returns the __invalid__ sentinel (not {_uuid:{$in:[]}}) when candidate list is empty, so MongoQuerySimplifier cannot erase it', async () => {
        // MongoQuerySimplifier.simplifyFilter deletes empty $in arrays and the now-empty parent
        // clauses around them, which would turn {_uuid:{$in:[]}} into {} once this filter is AND'd
        // into the rest of the query in constructQueryAsync -- silently converting a zero-match
        // _content search into "no filter, so return everything". __invalid__ survives
        // simplification because it's a literal string value, not an array.
        const clinicalNoteSearchClient = { findMatchingResourceIdsAsync: async () => [] };
        const searchManager = makeSearchManager({
            configManager: { fhirNotesFullTextSearchConfigured: true },
            clinicalNoteSearchClient
        });
        const result = await searchManager.buildContentSearchIdFilterAsync({
            resourceType: 'DocumentReference',
            parsedArgs: makeParsedArgsWithContent('diabetes'),
            operation: 'READ'
        });
        expect(result).toEqual({ _uuid: '__invalid__' });
    });

    test('propagates ExternalTimeoutError from the search client unchanged', async () => {
        const clinicalNoteSearchClient = {
            findMatchingResourceIdsAsync: async () => { throw new ExternalTimeoutError('down'); }
        };
        const searchManager = makeSearchManager({
            configManager: { fhirNotesFullTextSearchConfigured: true },
            clinicalNoteSearchClient
        });
        await expectRejectionWithStatusCode(searchManager.buildContentSearchIdFilterAsync({
            resourceType: 'DocumentReference',
            parsedArgs: makeParsedArgsWithContent('diabetes'),
            operation: 'READ'
        }), 504);
    });
});
