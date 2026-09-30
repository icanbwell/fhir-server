'use strict';

const { describe, test, expect, beforeEach, afterEach, jest: jestGlobal } = require('@jest/globals');

const { RemoveBadRecordsRunner } = require('../../../../admin/runners/removeBadRecordsRunner');
const { AdminLogger } = require('../../../../admin/adminLogger');
const { MongoDatabaseManager } = require('../../../../utils/mongoDatabaseManager');
const { IndexManager } = require('../../../../indexes/indexManager');

function createMockInstance (ClassType) {
    return Object.create(ClassType.prototype);
}

describe('RemoveBadRecordsRunner', () => {
    let mockAdminLogger;
    let mockMongoDatabaseManager;
    let mockIndexManager;
    let mockDb;
    let consoleErrorSpy;

    function makeCollection (deletedCount = 0) {
        return { deleteMany: jestGlobal.fn().mockResolvedValue({ deletedCount }) };
    }

    function makeRunner (overrides = {}) {
        return new RemoveBadRecordsRunner({
            indexManager: mockIndexManager,
            collections: ['Patient_4_0_0'],
            useAuditDatabase: false,
            includeHistoryCollections: false,
            adminLogger: mockAdminLogger,
            mongoDatabaseManager: mockMongoDatabaseManager,
            ...overrides
        });
    }

    beforeEach(() => {
        mockAdminLogger = createMockInstance(AdminLogger);
        mockAdminLogger.logInfo = jestGlobal.fn();
        mockAdminLogger.logError = jestGlobal.fn();

        mockDb = { collection: jestGlobal.fn().mockReturnValue(makeCollection(0)) };

        mockMongoDatabaseManager = createMockInstance(MongoDatabaseManager);
        mockMongoDatabaseManager.getClientDbAsync = jestGlobal.fn().mockResolvedValue(mockDb);
        mockMongoDatabaseManager.getAuditDbAsync = jestGlobal.fn().mockResolvedValue(mockDb);

        mockIndexManager = createMockInstance(IndexManager);

        consoleErrorSpy = jestGlobal.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
        consoleErrorSpy.mockRestore();
    });

    // =====================================================
    // constructor
    // =====================================================
    describe('constructor', () => {
        test('rejects an indexManager that is not an IndexManager instance', () => {
            expect(() => makeRunner({ indexManager: { foo: 'bar' } })).toThrow();
        });
    });

    // =====================================================
    // processAsync
    // =====================================================
    describe('processAsync', () => {
        test('uses the main client db when useAuditDatabase is false', async () => {
            const runner = makeRunner({ useAuditDatabase: false });

            await runner.processAsync();

            expect(mockMongoDatabaseManager.getClientDbAsync).toHaveBeenCalledTimes(1);
            expect(mockMongoDatabaseManager.getAuditDbAsync).not.toHaveBeenCalled();
        });

        test('uses the audit db when useAuditDatabase is true', async () => {
            const runner = makeRunner({ useAuditDatabase: true });

            await runner.processAsync();

            expect(mockMongoDatabaseManager.getAuditDbAsync).toHaveBeenCalledTimes(1);
            expect(mockMongoDatabaseManager.getClientDbAsync).not.toHaveBeenCalled();
        });

        test('expands the "all" sentinel via getAllCollectionNamesAsync and sorts the result', async () => {
            const runner = makeRunner({ collections: ['all'] });
            runner.getAllCollectionNamesAsync = jestGlobal.fn().mockResolvedValue(['Zebra_4_0_0', 'Account_4_0_0']);

            await runner.processAsync();

            expect(runner.getAllCollectionNamesAsync).toHaveBeenCalledWith({
                useAuditDatabase: false, includeHistoryCollections: false
            });
            expect(mockDb.collection).toHaveBeenCalledWith('Account_4_0_0');
            expect(mockDb.collection).toHaveBeenCalledWith('Zebra_4_0_0');
        });

        test('processes an explicit collection list without calling getAllCollectionNamesAsync', async () => {
            const runner = makeRunner({ collections: ['Patient_4_0_0'] });
            runner.getAllCollectionNamesAsync = jestGlobal.fn();

            await runner.processAsync();

            expect(runner.getAllCollectionNamesAsync).not.toHaveBeenCalled();
            expect(mockDb.collection).toHaveBeenCalledWith('Patient_4_0_0');
        });

        test('deletes documents matching { id: null } for every collection', async () => {
            const runner = makeRunner({ collections: ['Patient_4_0_0'] });
            const collection = makeCollection(3);
            mockDb.collection = jestGlobal.fn().mockReturnValue(collection);

            await runner.processAsync();

            expect(collection.deleteMany).toHaveBeenCalledWith({ id: null });
        });

        test('deletes documents matching { "_access.undefined": 1 } for every collection', async () => {
            const runner = makeRunner({ collections: ['Patient_4_0_0'] });
            const collection = makeCollection(2);
            mockDb.collection = jestGlobal.fn().mockReturnValue(collection);

            await runner.processAsync();

            expect(collection.deleteMany).toHaveBeenCalledWith({ '_access.undefined': 1 });
        });

        test('runs both delete filters for each of multiple collections', async () => {
            const runner = makeRunner({ collections: ['Patient_4_0_0', 'Practitioner_4_0_0'] });
            const collection = makeCollection(0);
            mockDb.collection = jestGlobal.fn().mockReturnValue(collection);

            await runner.processAsync();

            expect(mockDb.collection).toHaveBeenCalledWith('Patient_4_0_0');
            expect(mockDb.collection).toHaveBeenCalledWith('Practitioner_4_0_0');
            expect(collection.deleteMany).toHaveBeenCalledTimes(4);
        });

        test('logs the deleted count for each filter', async () => {
            const runner = makeRunner({ collections: ['Patient_4_0_0'] });
            mockDb.collection = jestGlobal.fn().mockReturnValue(makeCollection(7));

            await runner.processAsync();

            expect(mockAdminLogger.logInfo).toHaveBeenCalledWith(expect.stringContaining('Deleted 7 records'));
        });

        test('a deleteMany failure is caught, logged via console.error and adminLogger.logError, and does not throw', async () => {
            const runner = makeRunner({ collections: ['Patient_4_0_0'] });
            mockDb.collection = jestGlobal.fn().mockReturnValue({
                deleteMany: jestGlobal.fn().mockRejectedValue(new Error('mongo write conflict'))
            });

            await expect(runner.processAsync()).resolves.toBeUndefined();

            expect(consoleErrorSpy).toHaveBeenCalled();
            expect(mockAdminLogger.logError).toHaveBeenCalledWith(expect.stringContaining('mongo write conflict'));
        });

        test('shutdown always runs, even after a failure', async () => {
            const runner = makeRunner({ collections: ['Patient_4_0_0'] });
            runner.shutdown = jestGlobal.fn().mockResolvedValue(undefined);
            mockDb.collection = jestGlobal.fn().mockReturnValue({
                deleteMany: jestGlobal.fn().mockRejectedValue(new Error('boom'))
            });

            await runner.processAsync();

            expect(runner.shutdown).toHaveBeenCalledTimes(1);
        });
    });
});
