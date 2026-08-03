'use strict';

/**
 * Unit tests for SearchManager
 *
 * Top 3 largest methods:
 * 1. constructQueryAsync (lines 199-358)
 * 2. getCursorForQueryAsync (lines 376-548)
 * 3. streamResourcesFromCursorAsync (lines 915-1063)
 */

const { describe, beforeEach, afterEach, it, expect, jest } = require('@jest/globals');

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

jest.mock('../../../../operations/common/logging', () => ({
    logError: jest.fn(),
    logInfo: jest.fn(),
    logDebug: jest.fn()
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

    beforeEach(() => {
        mockDatabaseQueryFactory = Object.create(DatabaseQueryFactory.prototype);
        mockResourceLocatorFactory = Object.create(ResourceLocatorFactory.prototype);
        mockSecurityTagManager = Object.create(SecurityTagManager.prototype);
        mockResourcePreparer = Object.create(ResourcePreparer.prototype);
        mockIndexHinter = Object.create(IndexHinter.prototype);
        mockR4SearchQueryCreator = Object.create(R4SearchQueryCreator.prototype);
        mockConfigManager = Object.create(ConfigManager.prototype);
        Object.defineProperty(mockConfigManager, 'enableConsentedProaDataAccess', { value: false, writable: true, configurable: true });
        Object.defineProperty(mockConfigManager, 'enableHIETreatmentRelatedDataAccess', { value: false, writable: true, configurable: true });
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
            patientQueryCreator: mockPatientQueryCreator
        });
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    describe('constructQueryAsync', () => {
        let mockParsedArgs;

        beforeEach(() => {
            mockParsedArgs = { base_version: '4_0_0', _elements: null, _sort: null, _count: null, id: null };
            mockScopesManager.isAccessAllowedByPatientScopes = jest.fn().mockReturnValue(false);
            mockSecurityTagManager.getSecurityTagsFromScope = jest.fn().mockReturnValue(['client-abc']);
            mockSecurityTagManager.getQueryWithSecurityTags = jest.fn().mockReturnValue({ 'meta.security': { $elemMatch: { code: 'client-abc' } } });
            mockSearchQueryBuilder.buildSearchQueryBasedOnVersion = jest.fn().mockReturnValue({
                query: { resourceType: 'Observation' }, columns: new Set(['_uuid'])
            });
            mockConfigManager.enableConsentedProaDataAccess = false;
            mockConfigManager.enableHIETreatmentRelatedDataAccess = false;
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
        it('adds ascending sort', () => {
            const parsedArgs = { get: () => ({ queryParameterValue: { values: ['date'] } }), _sort: 'date' };
            const result = searchManager.handleSortQuery({ parsedArgs, columns: new Set(), options: {} });
            expect(result.options.sort.date).toBe(1);
        });

        it('adds descending sort with - prefix', () => {
            const parsedArgs = { get: () => ({ queryParameterValue: { values: ['-date'] } }), _sort: '-date' };
            const result = searchManager.handleSortQuery({ parsedArgs, columns: new Set(), options: {} });
            expect(result.options.sort.date).toBe(-1);
        });

        it('handles multiple sort properties', () => {
            const parsedArgs = { get: () => ({ queryParameterValue: { values: ['status', '-date', 'category'] } }), _sort: 'status,-date,category' };
            const result = searchManager.handleSortQuery({ parsedArgs, columns: new Set(), options: {} });
            expect(result.options.sort.status).toBe(1);
            expect(result.options.sort.date).toBe(-1);
            expect(result.options.sort.category).toBe(1);
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
