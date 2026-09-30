'use strict';

const { describe, test, expect, beforeEach, jest: jestGlobal } = require('@jest/globals');

const { CreateCollectionsRunner } = require('../../../../admin/runners/createCollectionsRunner');
const { AdminLogger } = require('../../../../admin/adminLogger');
const { MongoDatabaseManager } = require('../../../../utils/mongoDatabaseManager');
const { IndexManager } = require('../../../../indexes/indexManager');
const { ACCESS_LOGS_COLLECTION_NAME } = require('../../../../constants');

function createMockInstance (ClassType) {
    return Object.create(ClassType.prototype);
}

function makeDb (existingCollectionNames = []) {
    return {
        listCollections: jestGlobal.fn().mockReturnValue(
            existingCollectionNames.map((name) => ({ name, type: 'collection' }))
        ),
        createCollection: jestGlobal.fn().mockResolvedValue(undefined)
    };
}

describe('CreateCollectionsRunner', () => {
    let runner;
    let mockAdminLogger;
    let mockMongoDatabaseManager;
    let mockIndexManager;
    let mainDb;
    let historyDb;
    let accessLogsDb;
    let auditDb;

    beforeEach(() => {
        mockAdminLogger = createMockInstance(AdminLogger);
        mockAdminLogger.logInfo = jestGlobal.fn();
        mockAdminLogger.logError = jestGlobal.fn();

        mainDb = makeDb([]);
        historyDb = makeDb([]);
        accessLogsDb = makeDb([]);
        auditDb = makeDb([]);

        mockMongoDatabaseManager = createMockInstance(MongoDatabaseManager);
        mockMongoDatabaseManager.getClientDbAsync = jestGlobal.fn().mockResolvedValue(mainDb);
        mockMongoDatabaseManager.getResourceHistoryDbAsync = jestGlobal.fn().mockResolvedValue(historyDb);
        mockMongoDatabaseManager.getAccessLogsDbAsync = jestGlobal.fn().mockResolvedValue(accessLogsDb);
        mockMongoDatabaseManager.getAuditDbAsync = jestGlobal.fn().mockResolvedValue(auditDb);

        mockIndexManager = createMockInstance(IndexManager);
        mockIndexManager.synchronizeIndexesWithConfigAsync = jestGlobal.fn().mockResolvedValue(undefined);

        runner = new CreateCollectionsRunner({
            indexManager: mockIndexManager,
            adminLogger: mockAdminLogger,
            mongoDatabaseManager: mockMongoDatabaseManager
        });
    });

    // =====================================================
    // constructor
    // =====================================================
    describe('constructor', () => {
        test('rejects an indexManager that is not an IndexManager instance', () => {
            expect(() => new CreateCollectionsRunner({
                indexManager: { synchronizeIndexesWithConfigAsync: () => {} },
                adminLogger: mockAdminLogger,
                mongoDatabaseManager: mockMongoDatabaseManager
            })).toThrow();
        });
    });

    // =====================================================
    // processAsync
    // =====================================================
    describe('processAsync', () => {
        test('creates a main-db collection for every resource type in COLLECTION plus ExportStatus_4_0_0', async () => {
            await runner.processAsync();

            expect(mainDb.createCollection).toHaveBeenCalledWith('Patient_4_0_0');
            expect(mainDb.createCollection).toHaveBeenCalledWith('ExportStatus_4_0_0');
        });

        test('does not create a main-db collection that already exists', async () => {
            mainDb = makeDb(['Patient_4_0_0']);
            mockMongoDatabaseManager.getClientDbAsync = jestGlobal.fn().mockResolvedValue(mainDb);

            await runner.processAsync();

            expect(mainDb.createCollection).not.toHaveBeenCalledWith('Patient_4_0_0');
        });

        test('creates the matching _History collection in the history db', async () => {
            await runner.processAsync();

            expect(historyDb.createCollection).toHaveBeenCalledWith('Patient_4_0_0_History');
        });

        test('does not create a history collection that already exists', async () => {
            historyDb = makeDb(['Patient_4_0_0_History']);
            mockMongoDatabaseManager.getResourceHistoryDbAsync = jestGlobal.fn().mockResolvedValue(historyDb);

            await runner.processAsync();

            expect(historyDb.createCollection).not.toHaveBeenCalledWith('Patient_4_0_0_History');
        });

        test('excludes AuditEvent_4_0_0 from the generic main/history creation loop', async () => {
            await runner.processAsync();

            expect(historyDb.createCollection).not.toHaveBeenCalledWith('AuditEvent_4_0_0_History');
        });

        test('creates the AuditEvent_4_0_0 collection directly in the audit db when missing', async () => {
            await runner.processAsync();

            expect(auditDb.createCollection).toHaveBeenCalledWith('AuditEvent_4_0_0');
        });

        test('does not recreate the AuditEvent_4_0_0 collection when it already exists', async () => {
            auditDb = makeDb(['AuditEvent_4_0_0']);
            mockMongoDatabaseManager.getAuditDbAsync = jestGlobal.fn().mockResolvedValue(auditDb);

            await runner.processAsync();

            expect(auditDb.createCollection).not.toHaveBeenCalledWith('AuditEvent_4_0_0');
        });

        test('creates the access-logs collection when missing', async () => {
            await runner.processAsync();

            expect(accessLogsDb.createCollection).toHaveBeenCalledWith(ACCESS_LOGS_COLLECTION_NAME);
        });

        test('does not recreate the access-logs collection when it already exists', async () => {
            accessLogsDb = makeDb([ACCESS_LOGS_COLLECTION_NAME]);
            mockMongoDatabaseManager.getAccessLogsDbAsync = jestGlobal.fn().mockResolvedValue(accessLogsDb);

            await runner.processAsync();

            expect(accessLogsDb.createCollection).not.toHaveBeenCalledWith(ACCESS_LOGS_COLLECTION_NAME);
        });

        test('synchronizes indexes for audit, access-logs, and the main db, in that order', async () => {
            await runner.processAsync();

            expect(mockIndexManager.synchronizeIndexesWithConfigAsync).toHaveBeenNthCalledWith(1, { audit: true });
            expect(mockIndexManager.synchronizeIndexesWithConfigAsync).toHaveBeenNthCalledWith(2, { accessLogs: true });
            expect(mockIndexManager.synchronizeIndexesWithConfigAsync).toHaveBeenNthCalledWith(3, {});
        });

        test('a failure while creating a collection is caught and logged, not thrown', async () => {
            mainDb.createCollection.mockRejectedValueOnce(new Error('disk full'));

            await expect(runner.processAsync()).resolves.toBeUndefined();

            expect(mockAdminLogger.logError).toHaveBeenCalledWith('ERROR', { error: expect.any(Error) });
        });

        test('shutdown always runs, even after a failure', async () => {
            runner.shutdown = jestGlobal.fn().mockResolvedValue(undefined);
            mainDb.createCollection.mockRejectedValueOnce(new Error('boom'));

            await runner.processAsync();

            expect(runner.shutdown).toHaveBeenCalledTimes(1);
        });

        test('shutdown always runs on success too', async () => {
            runner.shutdown = jestGlobal.fn().mockResolvedValue(undefined);

            await runner.processAsync();

            expect(runner.shutdown).toHaveBeenCalledTimes(1);
        });
    });
});
