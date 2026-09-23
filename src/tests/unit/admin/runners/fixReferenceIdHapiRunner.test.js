'use strict';

const { describe, test, expect, beforeEach, jest: jestGlobal } = require('@jest/globals');

const { FixReferenceIdHapiRunner } = require('../../../../admin/runners/fixReferenceIdHapiRunner');
const { AdminLogger } = require('../../../../admin/adminLogger');
const { MongoDatabaseManager } = require('../../../../utils/mongoDatabaseManager');
const { PreSaveManager } = require('../../../../preSaveHandlers/preSave');
const { DatabaseQueryFactory } = require('../../../../dataLayer/databaseQueryFactory');
const { ResourceLocatorFactory } = require('../../../../operations/common/resourceLocatorFactory');
const { ResourceMerger } = require('../../../../operations/common/resourceMerger');
const { SearchParametersManager } = require('../../../../searchParameters/searchParametersManager');
const { SecurityTagSystem } = require('../../../../utils/securityTagSystem');

function createMockInstance (ClassType) {
    return Object.create(ClassType.prototype);
}

/**
 * A mongo-ish find cursor driven by an array of docs.
 * @param {Object[]} docs
 */
function makeCursor (docs) {
    let i = 0;
    return {
        hasNext: jestGlobal.fn(async () => i < docs.length),
        next: jestGlobal.fn(async () => docs[i++])
    };
}

describe('FixReferenceIdHapiRunner', () => {
    let runner;
    let mockAdminLogger;
    let mockMongoDatabaseManager;

    function makeRunner (overrides = {}) {
        return new FixReferenceIdHapiRunner({
            collections: ['Observation_4_0_0'],
            batchSize: 100,
            referenceBatchSize: 100,
            collectionConcurrency: 1,
            adminLogger: mockAdminLogger,
            mongoDatabaseManager: mockMongoDatabaseManager,
            preSaveManager: createMockInstance(PreSaveManager),
            afterLastUpdatedDate: undefined,
            beforeLastUpdatedDate: undefined,
            databaseQueryFactory: createMockInstance(DatabaseQueryFactory),
            startFromCollection: undefined,
            resourceLocatorFactory: createMockInstance(ResourceLocatorFactory),
            proaCollections: [],
            limit: undefined,
            properties: undefined,
            resourceMerger: createMockInstance(ResourceMerger),
            useTransaction: undefined,
            skip: undefined,
            filterToRecordsWithFields: undefined,
            startFromId: undefined,
            searchParametersManager: createMockInstance(SearchParametersManager),
            ...overrides
        });
    }

    beforeEach(() => {
        mockAdminLogger = createMockInstance(AdminLogger);
        mockAdminLogger.logInfo = jestGlobal.fn();
        mockAdminLogger.logError = jestGlobal.fn();

        mockMongoDatabaseManager = createMockInstance(MongoDatabaseManager);
        mockMongoDatabaseManager.getClientConfigAsync = jestGlobal.fn().mockResolvedValue({
            connection: 'mongodb://localhost:27017',
            db_name: 'test_db',
            options: {}
        });

        runner = makeRunner();
    });

    // =====================================================
    // getQueryForResource
    // =====================================================
    describe('getQueryForResource', () => {
        test('filters non-history collections on the top-level _sourceAssigningAuthority field', () => {
            const query = runner.getQueryForResource(false);
            expect(query).toEqual({ $and: [{ _sourceAssigningAuthority: 'humanapi' }] });
        });

        test('filters history collections through the resource. prefix', () => {
            const query = runner.getQueryForResource(true);
            expect(query).toEqual({ $and: [{ 'resource._sourceAssigningAuthority': 'humanapi' }] });
        });

        test('merges the humanapi filter with a date-range query from the constructor', () => {
            runner.afterLastUpdatedDate = '2024-01-01';
            const query = runner.getQueryForResource(false);
            expect(query.$and).toHaveLength(2);
            expect(query.$and[1]).toEqual({ _sourceAssigningAuthority: 'humanapi' });
            expect(query.$and[0]['meta.lastUpdated']).toEqual({ $gt: '2024-01-01' });
        });
    });

    // =====================================================
    // getOriginalId
    // =====================================================
    describe('getOriginalId', () => {
        test('strips the HumanApi- prefix for a non-Observation resource', () => {
            const id = runner.getOriginalId({ doc: { resourceType: 'Patient', _sourceId: 'HumanApi-abc123' }, _sanitize: false });
            expect(id).toBe('abc123');
        });

        test('an Observation with a 64-char _sourceId falls back to code.coding[0].code', () => {
            const sourceId = 'HumanApi-original-id-here-000000000000000000000000000'.padEnd(64, '0');
            expect(sourceId.length).toBe(64);
            const doc = {
                resourceType: 'Observation',
                _sourceId: sourceId,
                code: { coding: [{ code: 'LOINC:1234' }] }
            };

            const id = runner.getOriginalId({ doc, _sanitize: false });

            expect(id).toBe(`${sourceId.split('-')[1]}-LOINC:1234`.replace(/[^A-Za-z0-9\-.]/g, '-'));
        });

        test('an Observation with a 64-char _sourceId falls back to code.text when coding is absent', () => {
            const sourceId = 'HumanApi-original-id-here-000000000000000000000000000'.padEnd(64, '0');
            const doc = { resourceType: 'Observation', _sourceId: sourceId, code: { text: 'Free text result' } };

            const id = runner.getOriginalId({ doc, _sanitize: false });

            expect(id).toContain('Free-text-result');
        });

        test('an Observation with a 64-char _sourceId but no code falls through to the default strip', () => {
            const sourceId = 'HumanApi-original-id-here-000000000000000000000000000'.padEnd(64, '0');
            const doc = { resourceType: 'Observation', _sourceId: sourceId };

            const id = runner.getOriginalId({ doc, _sanitize: false });

            expect(id).toBe(sourceId.replace('HumanApi-', ''));
        });
    });

    // =====================================================
    // getCurrentIds
    // =====================================================
    describe('getCurrentIds', () => {
        test('rebuilds the HumanApi-prefixed id from the original id', () => {
            const ids = runner.getCurrentIds({ originalId: 'abc123' });
            expect(ids).toEqual(['HumanApi-abc123']);
        });

        test('truncates ids longer than 64 characters, matching how they were originally stored', () => {
            const longId = 'x'.repeat(100);
            const ids = runner.getCurrentIds({ originalId: longId });
            expect(ids[0]).toHaveLength(64);
            expect(ids[0]).toBe(`HumanApi-${longId}`.slice(0, 64));
        });
    });

    // =====================================================
    // cacheReferencesAsync
    // =====================================================
    describe('cacheReferencesAsync', () => {
        let mockCollection;
        let mockSession;
        let mockClient;

        function wireConnection (docs) {
            const cursor = makeCursor(docs);
            mockCollection = { find: jestGlobal.fn().mockReturnValue(cursor) };
            mockSession = { endSession: jestGlobal.fn().mockResolvedValue(undefined) };
            mockClient = { close: jestGlobal.fn().mockResolvedValue(undefined) };
            runner.createSingeConnectionAsync = jestGlobal.fn().mockResolvedValue({
                collection: mockCollection, session: mockSession, client: mockClient
            });
            return cursor;
        }

        test('projects resourceType and code fields for Observation collections', async () => {
            wireConnection([]);

            await runner.cacheReferencesAsync({ mongoConfig: {}, collectionName: 'Observation_4_0_0' });

            const { projection } = mockCollection.find.mock.calls[0][1];
            expect(projection.resourceType).toBe(1);
            expect(projection.code).toEqual({ coding: { code: 1 }, text: 1 });
        });

        test('does not add the Observation code projection for other collections', async () => {
            wireConnection([]);

            await runner.cacheReferencesAsync({ mongoConfig: {}, collectionName: 'Patient_4_0_0' });

            const { projection } = mockCollection.find.mock.calls[0][1];
            expect(projection.code).toBeUndefined();
        });

        test('caches a reference mapping for each matching humanapi document', async () => {
            const doc = {
                _sourceId: 'HumanApi-orig-1',
                _sourceAssigningAuthority: 'tenantA',
                resourceType: 'Patient'
            };
            wireConnection([doc]);

            await runner.cacheReferencesAsync({ mongoConfig: {}, collectionName: 'Patient_4_0_0' });

            const cache = runner.getCacheForReference({ collectionName: 'Patient_4_0_0' });
            expect(cache.get('Patient/HumanApi-orig-1')).toBe('Patient/orig-1');
        });

        test('unwraps resource.* fields before caching for history collections', async () => {
            const historyDoc = {
                resource: { _sourceId: 'HumanApi-orig-2', _sourceAssigningAuthority: 'tenantA', resourceType: 'Patient' }
            };
            wireConnection([historyDoc]);

            await runner.cacheReferencesAsync({ mongoConfig: {}, collectionName: 'Patient_4_0_0_History' });

            const cache = runner.getCacheForReference({ collectionName: 'Patient_4_0_0_History' });
            expect(cache.get('Patient/HumanApi-orig-2')).toBe('Patient/orig-2');
        });

        test('always ends the session and closes the client, even when the cursor throws', async () => {
            mockCollection = { find: jestGlobal.fn(() => { throw new Error('cursor blew up'); }) };
            mockSession = { endSession: jestGlobal.fn().mockResolvedValue(undefined) };
            mockClient = { close: jestGlobal.fn().mockResolvedValue(undefined) };
            runner.createSingeConnectionAsync = jestGlobal.fn().mockResolvedValue({
                collection: mockCollection, session: mockSession, client: mockClient
            });

            await expect(runner.cacheReferencesAsync({ mongoConfig: {}, collectionName: 'Patient_4_0_0' }))
                .rejects.toThrow(/Error caching references/);

            expect(mockSession.endSession).toHaveBeenCalledTimes(1);
            expect(mockClient.close).toHaveBeenCalledTimes(1);
        });

        test('a document whose sourceAssigningAuthority comes from meta.security still caches correctly', async () => {
            const doc = {
                _sourceId: 'HumanApi-orig-3',
                resourceType: 'Patient',
                meta: { security: [{ system: SecurityTagSystem.sourceAssigningAuthority, code: 'tenantB' }] }
            };
            wireConnection([doc]);

            await runner.cacheReferencesAsync({ mongoConfig: {}, collectionName: 'Patient_4_0_0' });

            const cache = runner.getCacheForReference({ collectionName: 'Patient_4_0_0' });
            expect(cache.get('Patient/HumanApi-orig-3')).toBe('Patient/orig-3');
        });
    });
});
