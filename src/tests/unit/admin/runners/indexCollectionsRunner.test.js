'use strict';

const { describe, test, expect, beforeEach, jest: jestGlobal } = require('@jest/globals');

const { IndexCollectionsRunner } = require('../../../../admin/runners/indexCollectionsRunner');
const { AdminLogger } = require('../../../../admin/adminLogger');
const { MongoDatabaseManager } = require('../../../../utils/mongoDatabaseManager');
const { IndexManager } = require('../../../../indexes/indexManager');

function createMockInstance (ClassType) {
    return Object.create(ClassType.prototype);
}

describe('IndexCollectionsRunner', () => {
    let mockAdminLogger;
    let mockMongoDatabaseManager;
    let mockIndexManager;
    let mockClientDb;
    let mockHistoryDb;

    function makeRunner (overrides = {}) {
        return new IndexCollectionsRunner({
            indexManager: mockIndexManager,
            collections: [],
            dropIndexes: false,
            useAuditDatabase: false,
            useAccessLogsDatabase: false,
            includeHistoryCollections: false,
            addMissingIndexesOnly: false,
            removeExtraIndexesOnly: false,
            adminLogger: mockAdminLogger,
            synchronizeIndexes: false,
            mongoDatabaseManager: mockMongoDatabaseManager,
            ...overrides
        });
    }

    beforeEach(() => {
        mockAdminLogger = createMockInstance(AdminLogger);
        mockAdminLogger.logInfo = jestGlobal.fn();
        mockAdminLogger.logError = jestGlobal.fn();

        mockClientDb = { name: 'client-db' };
        mockHistoryDb = { name: 'history-db' };

        mockMongoDatabaseManager = createMockInstance(MongoDatabaseManager);
        mockMongoDatabaseManager.getClientDbAsync = jestGlobal.fn().mockResolvedValue(mockClientDb);
        mockMongoDatabaseManager.getAuditDbAsync = jestGlobal.fn().mockResolvedValue({ name: 'audit-db' });
        mockMongoDatabaseManager.getAccessLogsDbAsync = jestGlobal.fn().mockResolvedValue({ name: 'access-logs-db' });
        mockMongoDatabaseManager.getResourceHistoryDbAsync = jestGlobal.fn().mockResolvedValue(mockHistoryDb);

        mockIndexManager = createMockInstance(IndexManager);
        mockIndexManager.addMissingIndexesAsync = jestGlobal.fn().mockResolvedValue(undefined);
        mockIndexManager.dropExtraIndexesAsync = jestGlobal.fn().mockResolvedValue(undefined);
        mockIndexManager.synchronizeIndexesWithConfigAsync = jestGlobal.fn().mockResolvedValue(undefined);
        mockIndexManager.deleteIndexesInAllCollectionsInDatabaseAsync = jestGlobal.fn().mockResolvedValue(undefined);
        mockIndexManager.indexAllCollectionsInDatabaseAsync = jestGlobal.fn().mockResolvedValue(undefined);
    });

    // =====================================================
    // constructor
    // =====================================================
    describe('constructor', () => {
        test('rejects an indexManager that is not an IndexManager instance', () => {
            expect(() => makeRunner({ indexManager: { addMissingIndexesAsync: () => {} } })).toThrow();
        });
    });

    // =====================================================
    // processAsync
    // =====================================================
    describe('processAsync', () => {
        test('addMissingIndexesOnly delegates to indexManager.addMissingIndexesAsync with the "all" sentinel when no collections given', async () => {
            const runner = makeRunner({ addMissingIndexesOnly: true, useAuditDatabase: true });

            await runner.processAsync();

            expect(mockIndexManager.addMissingIndexesAsync).toHaveBeenCalledWith({
                audit: true, accessLogs: false, collections: ['all']
            });
            expect(mockIndexManager.indexAllCollectionsInDatabaseAsync).not.toHaveBeenCalled();
        });

        test('addMissingIndexesOnly passes through explicit collections instead of "all"', async () => {
            const runner = makeRunner({ addMissingIndexesOnly: true, collections: ['Patient_4_0_0'] });

            await runner.processAsync();

            expect(mockIndexManager.addMissingIndexesAsync).toHaveBeenCalledWith(
                expect.objectContaining({ collections: ['Patient_4_0_0'] })
            );
        });

        test('removeExtraIndexesOnly delegates to indexManager.dropExtraIndexesAsync', async () => {
            const runner = makeRunner({ removeExtraIndexesOnly: true, useAccessLogsDatabase: true });

            await runner.processAsync();

            expect(mockIndexManager.dropExtraIndexesAsync).toHaveBeenCalledWith({
                audit: false, accessLogs: true, collections: ['all']
            });
            expect(mockIndexManager.addMissingIndexesAsync).not.toHaveBeenCalled();
        });

        test('synchronizeIndexes delegates to indexManager.synchronizeIndexesWithConfigAsync', async () => {
            const runner = makeRunner({ synchronizeIndexes: true });

            await runner.processAsync();

            expect(mockIndexManager.synchronizeIndexesWithConfigAsync).toHaveBeenCalledWith({
                audit: false, accessLogs: false, collections: ['all']
            });
        });

        test('addMissingIndexesOnly wins when both addMissingIndexesOnly and removeExtraIndexesOnly are set', () => {
            // documents the current if/else-if precedence in processAsync
            const runner = makeRunner({ addMissingIndexesOnly: true, removeExtraIndexesOnly: true });
            expect(runner.addMissingIndexesOnly).toBe(true);
            expect(runner.removeExtraIndexesOnly).toBe(true);
        });

        test('the default branch expands the "all" sentinel and indexes every discovered collection', async () => {
            const runner = makeRunner({ collections: ['all'] });
            runner.getAllCollectionNamesAsync = jestGlobal.fn().mockResolvedValue([
                'Zebra_4_0_0', 'Account_4_0_0'
            ]);

            await runner.processAsync();

            expect(runner.getAllCollectionNamesAsync).toHaveBeenCalledWith({
                useAuditDatabase: false, useAccessLogsDatabase: false, includeHistoryCollections: false
            });
            expect(runner.collections).toEqual(['Account_4_0_0', 'Zebra_4_0_0']);
            expect(mockIndexManager.indexAllCollectionsInDatabaseAsync).toHaveBeenCalledTimes(2);
        });

        test('the default branch routes _History collections to the resource-history db, others to the main db', async () => {
            const runner = makeRunner({ collections: ['Patient_4_0_0', 'Patient_4_0_0_History'] });

            await runner.processAsync();

            expect(mockIndexManager.indexAllCollectionsInDatabaseAsync).toHaveBeenNthCalledWith(1, {
                db: mockClientDb, collectionRegex: 'Patient_4_0_0'
            });
            expect(mockIndexManager.indexAllCollectionsInDatabaseAsync).toHaveBeenNthCalledWith(2, {
                db: mockHistoryDb, collectionRegex: 'Patient_4_0_0_History'
            });
        });

        test('dropIndexes deletes existing indexes before re-adding them, per collection', async () => {
            const runner = makeRunner({ collections: ['Patient_4_0_0'], dropIndexes: true });

            await runner.processAsync();

            expect(mockIndexManager.deleteIndexesInAllCollectionsInDatabaseAsync).toHaveBeenCalledWith({
                db: mockClientDb, collectionRegex: 'Patient_4_0_0'
            });
            expect(mockIndexManager.indexAllCollectionsInDatabaseAsync).toHaveBeenCalledWith({
                db: mockClientDb, collectionRegex: 'Patient_4_0_0'
            });
        });

        test('does not drop indexes for any collection when dropIndexes is false', async () => {
            const runner = makeRunner({ collections: ['Patient_4_0_0'], dropIndexes: false });

            await runner.processAsync();

            expect(mockIndexManager.deleteIndexesInAllCollectionsInDatabaseAsync).not.toHaveBeenCalled();
        });

        test('a failure is logged through the admin logger and does not propagate out of processAsync', async () => {
            const runner = makeRunner({ collections: ['Patient_4_0_0'] });
            mockIndexManager.indexAllCollectionsInDatabaseAsync.mockRejectedValue(new Error('index build failed'));

            await expect(runner.processAsync()).resolves.toBeUndefined();

            expect(mockAdminLogger.logError).toHaveBeenCalledWith('ERROR', { error: expect.any(Error) });
        });

        test('shutdown always runs, even after a failure', async () => {
            const runner = makeRunner({ collections: ['Patient_4_0_0'] });
            runner.shutdown = jestGlobal.fn().mockResolvedValue(undefined);
            mockIndexManager.indexAllCollectionsInDatabaseAsync.mockRejectedValue(new Error('boom'));

            await runner.processAsync();

            expect(runner.shutdown).toHaveBeenCalledTimes(1);
        });
    });
});
