'use strict';

const { describe, test, expect, beforeEach, jest: jestGlobal } = require('@jest/globals');

const { BaseScriptRunner } = require('../../../../admin/runners/baseScriptRunner');
const { AdminLogger } = require('../../../../admin/adminLogger');
const { MongoDatabaseManager } = require('../../../../utils/mongoDatabaseManager');

function createMockInstance (ClassType) {
    return Object.create(ClassType.prototype);
}

/**
 * Builds an object that behaves like the async-iterable returned by db.listCollections()
 * @param {string[]} names
 */
function makeListCollectionsIterable (names) {
    return {
        [Symbol.asyncIterator] () {
            let i = 0;
            return {
                async next () {
                    if (i < names.length) {
                        return { value: { name: names[i++], type: 'collection' }, done: false };
                    }
                    return { value: undefined, done: true };
                }
            };
        }
    };
}

function makeDb (names, { throwOnList = false } = {}) {
    return {
        listCollections: jestGlobal.fn().mockImplementation(() => {
            if (throwOnList) {
                throw new Error('listCollections failed: connection reset by peer');
            }
            return makeListCollectionsIterable(names);
        })
    };
}

describe('BaseScriptRunner', () => {
    let runner;
    let mockAdminLogger;
    let mockMongoDatabaseManager;

    beforeEach(() => {
        mockAdminLogger = createMockInstance(AdminLogger);
        mockAdminLogger.logInfo = jestGlobal.fn();
        mockAdminLogger.logError = jestGlobal.fn();

        mockMongoDatabaseManager = createMockInstance(MongoDatabaseManager);
        mockMongoDatabaseManager.getClientConfigAsync = jestGlobal.fn().mockResolvedValue({
            connection: 'mongodb://localhost:27017',
            db_name: 'client_db',
            options: {}
        });
        mockMongoDatabaseManager.getAuditConfigAsync = jestGlobal.fn().mockResolvedValue({
            connection: 'mongodb://localhost:27017',
            db_name: 'audit_db',
            options: {}
        });
        mockMongoDatabaseManager.getAccessLogsConfigAsync = jestGlobal.fn().mockResolvedValue({
            connection: 'mongodb://localhost:27017',
            db_name: 'access_logs_db',
            options: {}
        });
        mockMongoDatabaseManager.getResourceHistoryDbAsync = jestGlobal.fn();
        mockMongoDatabaseManager.createClientAsync = jestGlobal.fn();
        mockMongoDatabaseManager.disconnectClientAsync = jestGlobal.fn().mockResolvedValue(undefined);

        runner = new BaseScriptRunner({
            adminLogger: mockAdminLogger,
            mongoDatabaseManager: mockMongoDatabaseManager
        });
    });

    // =====================================================
    // constructor
    // =====================================================
    describe('constructor', () => {
        test('rejects an adminLogger that is not an AdminLogger instance', () => {
            expect(() => new BaseScriptRunner({
                adminLogger: { logInfo: () => {} },
                mongoDatabaseManager: mockMongoDatabaseManager
            })).toThrow();
        });

        test('rejects a mongoDatabaseManager that is not a MongoDatabaseManager instance', () => {
            expect(() => new BaseScriptRunner({
                adminLogger: mockAdminLogger,
                mongoDatabaseManager: { getClientConfigAsync: () => {} }
            })).toThrow();
        });

        test('stores the injected collaborators on the instance', () => {
            expect(runner.adminLogger).toBe(mockAdminLogger);
            expect(runner.mongoDatabaseManager).toBe(mockMongoDatabaseManager);
        });
    });

    // =====================================================
    // createStartFromIdContainer / init
    // =====================================================
    describe('createStartFromIdContainer', () => {
        test('returns every progress counter zeroed and startFromId empty', () => {
            const container = runner.createStartFromIdContainer();

            expect(container.startFromId).toBe('');
            expect(container.skippedIdsForHavingAccessField).toBe(0);
            expect(container.skippedIdsForMissingSecurityTags).toBe(0);
            expect(container.skippedIdsForMissingAccessTags).toBe(0);
            expect(container.convertedIds).toBe(0);
            expect(container.nModified).toBe(0);
            expect(container.nUpserted).toBe(0);
            expect(container.numScanned).toBe(0);
            expect(container.numOperations).toBe(0);
            expect(container.numberWritten).toBe(0);
            expect(container.numberOfDocumentsToCopy).toBe(0);
        });

        test('returns a fresh container per call so per-collection progress never leaks across collections', () => {
            const first = runner.createStartFromIdContainer();
            first.numScanned = 500;
            first.startFromId = 'abc';
            first.nModified = 42;

            const second = runner.createStartFromIdContainer();

            expect(second).not.toBe(first);
            expect(second.numScanned).toBe(0);
            expect(second.startFromId).toBe('');
            expect(second.nModified).toBe(0);
        });

        test('init() installs a zeroed startFromIdContainer on the runner', async () => {
            expect(runner.startFromIdContainer).toBeUndefined();

            await runner.init();

            expect(runner.startFromIdContainer.numScanned).toBe(0);
            expect(runner.startFromIdContainer.startFromId).toBe('');
        });

        test('init() resets a previously dirtied container', async () => {
            await runner.init();
            runner.startFromIdContainer.numScanned = 99;

            await runner.init();

            expect(runner.startFromIdContainer.numScanned).toBe(0);
        });
    });

    // =====================================================
    // getAllCollectionNamesForDb
    // =====================================================
    describe('getAllCollectionNamesForDb', () => {
        test('returns every non-system collection name in iteration order', async () => {
            const db = makeDb(['Patient_4_0_0', 'Person_4_0_0', 'Observation_4_0_0']);

            const result = await runner.getAllCollectionNamesForDb({ db });

            expect(result).toEqual(['Patient_4_0_0', 'Person_4_0_0', 'Observation_4_0_0']);
        });

        test('SEC-ADMIN-SYSCOLL: filters out mongo system and GridFS collections', async () => {
            const db = makeDb([
                'system.profile',
                'Patient_4_0_0',
                'fs.files',
                'fs.chunks',
                'Person_4_0_0',
                'system.views'
            ]);

            const result = await runner.getAllCollectionNamesForDb({ db });

            expect(result).toEqual(['Patient_4_0_0', 'Person_4_0_0']);
            expect(result).not.toContain('system.profile');
            expect(result).not.toContain('fs.files');
            expect(result).not.toContain('fs.chunks');
        });

        test('excludes views at the mongo query level', async () => {
            const db = makeDb(['Patient_4_0_0']);

            await runner.getAllCollectionNamesForDb({ db });

            expect(db.listCollections).toHaveBeenCalledWith(
                { type: { $ne: 'view' } },
                { nameOnly: true }
            );
        });

        test('returns an empty array for a database with no collections', async () => {
            const db = makeDb([]);

            const result = await runner.getAllCollectionNamesForDb({ db });

            expect(result).toEqual([]);
        });
    });

    // =====================================================
    // getAllCollectionNamesAsync
    // =====================================================
    describe('getAllCollectionNamesAsync', () => {
        test('uses the client config and drops _History collections by default', async () => {
            const db = makeDb([
                'Patient_4_0_0',
                'Patient_4_0_0_History',
                'Person_4_0_0',
                'Person_4_0_0_History'
            ]);
            const client = { db: jestGlobal.fn().mockReturnValue(db) };
            mockMongoDatabaseManager.createClientAsync.mockResolvedValue(client);

            const result = await runner.getAllCollectionNamesAsync({
                useAuditDatabase: false,
                useAccessLogsDatabase: false,
                includeHistoryCollections: false
            });

            expect(result).toEqual(['Patient_4_0_0', 'Person_4_0_0']);
            expect(mockMongoDatabaseManager.getClientConfigAsync).toHaveBeenCalled();
            expect(client.db).toHaveBeenCalledWith('client_db');
        });

        test('uses the audit config when useAuditDatabase is true', async () => {
            const db = makeDb(['AuditEvent_4_0_0']);
            const client = { db: jestGlobal.fn().mockReturnValue(db) };
            mockMongoDatabaseManager.createClientAsync.mockResolvedValue(client);

            const result = await runner.getAllCollectionNamesAsync({
                useAuditDatabase: true,
                useAccessLogsDatabase: false,
                includeHistoryCollections: false
            });

            expect(result).toEqual(['AuditEvent_4_0_0']);
            expect(mockMongoDatabaseManager.getAuditConfigAsync).toHaveBeenCalled();
            expect(mockMongoDatabaseManager.getClientConfigAsync).not.toHaveBeenCalled();
            expect(client.db).toHaveBeenCalledWith('audit_db');
        });

        test('uses the access-logs config when useAccessLogsDatabase is true', async () => {
            const db = makeDb(['AccessLog_4_0_0']);
            const client = { db: jestGlobal.fn().mockReturnValue(db) };
            mockMongoDatabaseManager.createClientAsync.mockResolvedValue(client);

            const result = await runner.getAllCollectionNamesAsync({
                useAuditDatabase: false,
                useAccessLogsDatabase: true,
                includeHistoryCollections: false
            });

            expect(result).toEqual(['AccessLog_4_0_0']);
            expect(mockMongoDatabaseManager.getAccessLogsConfigAsync).toHaveBeenCalled();
            expect(client.db).toHaveBeenCalledWith('access_logs_db');
        });

        test('SEC-ADMIN-DBSEL: audit database wins over access-logs when both flags are set', async () => {
            // Writing audit rows into the access-logs database (or vice-versa) would cross a
            // storage boundary, so the precedence must be deterministic, not accidental.
            const db = makeDb(['AuditEvent_4_0_0']);
            const client = { db: jestGlobal.fn().mockReturnValue(db) };
            mockMongoDatabaseManager.createClientAsync.mockResolvedValue(client);

            await runner.getAllCollectionNamesAsync({
                useAuditDatabase: true,
                useAccessLogsDatabase: true,
                includeHistoryCollections: false
            });

            expect(mockMongoDatabaseManager.getAuditConfigAsync).toHaveBeenCalled();
            expect(mockMongoDatabaseManager.getAccessLogsConfigAsync).not.toHaveBeenCalled();
            expect(client.db).toHaveBeenCalledWith('audit_db');
        });

        test('merges resource-history-db collections and de-duplicates when includeHistoryCollections is true', async () => {
            const clientDb = makeDb(['Patient_4_0_0', 'Patient_4_0_0_History']);
            const historyDb = makeDb(['Patient_4_0_0_History', 'Person_4_0_0_History']);
            const client = { db: jestGlobal.fn().mockReturnValue(clientDb) };
            mockMongoDatabaseManager.createClientAsync.mockResolvedValue(client);
            mockMongoDatabaseManager.getResourceHistoryDbAsync.mockResolvedValue(historyDb);

            const result = await runner.getAllCollectionNamesAsync({
                useAuditDatabase: false,
                useAccessLogsDatabase: false,
                includeHistoryCollections: true
            });

            expect(result).toEqual([
                'Patient_4_0_0',
                'Patient_4_0_0_History',
                'Person_4_0_0_History'
            ]);
            // de-duplicated: the shared history collection appears exactly once
            expect(result.filter((c) => c === 'Patient_4_0_0_History')).toHaveLength(1);
        });

        test('does not reach into the resource-history db when running against the audit db', async () => {
            const db = makeDb(['AuditEvent_4_0_0', 'AuditEvent_4_0_0_History']);
            const client = { db: jestGlobal.fn().mockReturnValue(db) };
            mockMongoDatabaseManager.createClientAsync.mockResolvedValue(client);

            const result = await runner.getAllCollectionNamesAsync({
                useAuditDatabase: true,
                useAccessLogsDatabase: false,
                includeHistoryCollections: true
            });

            expect(mockMongoDatabaseManager.getResourceHistoryDbAsync).not.toHaveBeenCalled();
            expect(result).toEqual(['AuditEvent_4_0_0', 'AuditEvent_4_0_0_History']);
        });

        test('disconnects the mongo client after a successful listing', async () => {
            const db = makeDb(['Patient_4_0_0']);
            const client = { db: jestGlobal.fn().mockReturnValue(db) };
            mockMongoDatabaseManager.createClientAsync.mockResolvedValue(client);

            await runner.getAllCollectionNamesAsync({
                useAuditDatabase: false,
                useAccessLogsDatabase: false,
                includeHistoryCollections: false
            });

            expect(mockMongoDatabaseManager.disconnectClientAsync).toHaveBeenCalledWith(client);
        });
    });

    // =====================================================
    // shutdown
    // =====================================================
    describe('shutdown', () => {
        test('resolves without touching the database manager', async () => {
            await expect(runner.shutdown()).resolves.toBeUndefined();
            expect(mockMongoDatabaseManager.disconnectClientAsync).not.toHaveBeenCalled();
        });
    });
});
