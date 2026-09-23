'use strict';

const { describe, test, expect, beforeEach, jest: jestGlobal } = require('@jest/globals');

const {
    MigrateBinaryDataToCloudStorageRunner
} = require('../../../../admin/runners/migrateBinaryDataToCloudStorageRunner');
const { AdminLogger } = require('../../../../admin/adminLogger');
const { MongoDatabaseManager } = require('../../../../utils/mongoDatabaseManager');
const { ConfigManager } = require('../../../../utils/configManager');
const { CloudStorageClient } = require('../../../../utils/cloudStorageClient');

function createMockInstance (ClassType) {
    return Object.create(ClassType.prototype);
}

/**
 * A mongo-ish find cursor: chainable, hasNext()/next() driven by an array of docs.
 * @param {Object[]} docs
 */
function makeCursor (docs) {
    let i = 0;
    const cursor = {
        sort: jestGlobal.fn(() => cursor),
        maxTimeMS: jestGlobal.fn(() => cursor),
        batchSize: jestGlobal.fn(() => cursor),
        addCursorFlag: jestGlobal.fn(() => cursor),
        limit: jestGlobal.fn(() => cursor),
        hasNext: jestGlobal.fn(async () => i < docs.length),
        next: jestGlobal.fn(async () => docs[i++])
    };
    return cursor;
}

function makeBinaryDoc (uuid, overrides = {}) {
    return {
        _id: `mongo-${uuid}`,
        _uuid: uuid,
        resourceType: 'Binary',
        data: 'x'.repeat(2048),
        meta: { versionId: '1', lastUpdated: '2024-01-02T03:04:05.000Z' },
        ...overrides
    };
}

describe('MigrateBinaryDataToCloudStorageRunner', () => {
    let mockAdminLogger;
    let mockMongoDatabaseManager;
    let mockCloudStorageClient;
    let configManager;
    let mockCollection;
    let mockDb;
    let mockClient;

    function baseParams (overrides = {}) {
        return {
            mongoDatabaseManager: mockMongoDatabaseManager,
            adminLogger: mockAdminLogger,
            batchSize: 10,
            concurrency: 2,
            thresholdKB: 1,
            base64FieldCloudStorageClient: mockCloudStorageClient,
            configManager,
            ...overrides
        };
    }

    function wireMongo (docs) {
        const cursor = makeCursor(docs);
        mockCollection = {
            find: jestGlobal.fn().mockReturnValue(cursor),
            updateOne: jestGlobal.fn().mockResolvedValue({ matchedCount: 1 }),
            findOne: jestGlobal.fn().mockResolvedValue(null)
        };
        const mockAdminCommand = jestGlobal.fn().mockResolvedValue({ ok: 1 });
        mockDb = {
            collection: jestGlobal.fn().mockReturnValue(mockCollection),
            admin: jestGlobal.fn().mockReturnValue({ command: mockAdminCommand })
        };
        mockClient = {
            startSession: jestGlobal.fn().mockReturnValue({
                serverSession: { id: 'session-1' },
                endSession: jestGlobal.fn().mockResolvedValue(undefined)
            }),
            db: jestGlobal.fn().mockReturnValue(mockDb)
        };
        mockMongoDatabaseManager.createClientAsync = jestGlobal.fn().mockResolvedValue(mockClient);
        mockMongoDatabaseManager.disconnectClientAsync = jestGlobal.fn().mockResolvedValue(undefined);
        return cursor;
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

        mockCloudStorageClient = createMockInstance(CloudStorageClient);
        mockCloudStorageClient.uploadAsync = jestGlobal.fn().mockResolvedValue({ ETag: 'etag-1' });
        mockCloudStorageClient.downloadAsync = jestGlobal.fn();
        mockCloudStorageClient.deleteAsync = jestGlobal.fn().mockResolvedValue(undefined);

        configManager = new ConfigManager();
    });

    // =====================================================
    // constructor
    // =====================================================
    describe('constructor', () => {
        test('rejects an invalid startId', () => {
            expect(() => new MigrateBinaryDataToCloudStorageRunner(baseParams({ startId: 'not-an-object-id' })))
                .toThrow(/Invalid startId/);
        });

        test('rejects an invalid uuid in --ids', () => {
            expect(() => new MigrateBinaryDataToCloudStorageRunner(baseParams({ uuids: ['not-a-uuid'] })))
                .toThrow(/Invalid uuid/);
        });

        test('rejects an unparseable fromDate', () => {
            expect(() => new MigrateBinaryDataToCloudStorageRunner(baseParams({ fromDate: 'not-a-date' })))
                .toThrow(/Invalid fromDate/);
        });

        test('rejects an unparseable toDate', () => {
            expect(() => new MigrateBinaryDataToCloudStorageRunner(baseParams({ toDate: 'not-a-date' })))
                .toThrow(/Invalid toDate/);
        });

        test('requires a real CloudStorageClient when dryRun is false', () => {
            expect(() => new MigrateBinaryDataToCloudStorageRunner(
                baseParams({ dryRun: false, base64FieldCloudStorageClient: { uploadAsync: () => {} } })
            )).toThrow();
        });

        test('does not require a CloudStorageClient when dryRun is true', () => {
            expect(() => new MigrateBinaryDataToCloudStorageRunner(
                baseParams({ dryRun: true, base64FieldCloudStorageClient: undefined })
            )).not.toThrow();
        });
    });

    // =====================================================
    // _buildQuery
    // =====================================================
    describe('_buildQuery', () => {
        test('always restricts to inline string data with no _blobMeta yet', () => {
            const runner = new MigrateBinaryDataToCloudStorageRunner(baseParams({}));
            const query = runner._buildQuery();
            expect(query.data).toEqual({ $exists: true, $type: 'string' });
            expect(query._blobMeta).toEqual({ $exists: false });
        });

        test('adds an _id $gt bound from a valid startId', () => {
            const startId = '507f1f77bcf86cd799439011';
            const runner = new MigrateBinaryDataToCloudStorageRunner(baseParams({ startId }));
            const query = runner._buildQuery();
            expect(query._id.$gt.toString()).toBe(startId);
        });

        test('adds a _uuid $in filter when specific uuids are requested', () => {
            const uuids = ['3f4c9d7e-0000-4000-8000-000000000001'];
            const runner = new MigrateBinaryDataToCloudStorageRunner(baseParams({ uuids }));
            const query = runner._buildQuery();
            expect(query._uuid).toEqual({ $in: uuids });
        });

        test('omits _id and _uuid filters entirely when none of startId/fromDate/toDate/uuids are given', () => {
            const runner = new MigrateBinaryDataToCloudStorageRunner(baseParams({}));
            const query = runner._buildQuery();
            expect(query._id).toBeUndefined();
            expect(query._uuid).toBeUndefined();
        });
    });

    // =====================================================
    // _exceedsThreshold
    // =====================================================
    describe('_exceedsThreshold', () => {
        test('returns false for non-string data', () => {
            const runner = new MigrateBinaryDataToCloudStorageRunner(baseParams({ thresholdKB: 1 }));
            expect(runner._exceedsThreshold(12345)).toBe(false);
        });

        test('returns false for data at/under the threshold and true above it', () => {
            const runner = new MigrateBinaryDataToCloudStorageRunner(baseParams({ thresholdKB: 1 }));
            expect(runner._exceedsThreshold('x'.repeat(1024))).toBe(false);
            expect(runner._exceedsThreshold('x'.repeat(1024 + 1))).toBe(true);
        });
    });

    // =====================================================
    // processRecordAsync
    // =====================================================
    describe('processRecordAsync', () => {
        test('skips a document already migrated (has _blobMeta)', async () => {
            const runner = new MigrateBinaryDataToCloudStorageRunner(baseParams({}));
            await runner.processRecordAsync(makeBinaryDoc('u1', { _blobMeta: { hash: 'h' } }), mockCollection);
            expect(runner.documentsSkippedAlreadyHandled).toBe(1);
            expect(mockCloudStorageClient.uploadAsync).not.toHaveBeenCalled();
        });

        test('skips a document whose data is below the size threshold', async () => {
            const runner = new MigrateBinaryDataToCloudStorageRunner(baseParams({ thresholdKB: 1000 }));
            wireMongo([]);
            await runner.processRecordAsync(makeBinaryDoc('u2'), mockCollection);
            expect(runner.documentsSkippedBelowThreshold).toBe(1);
        });

        test('skips and logs a document whose meta.lastUpdated is unparseable', async () => {
            const runner = new MigrateBinaryDataToCloudStorageRunner(baseParams({}));
            await runner.processRecordAsync(
                makeBinaryDoc('u3', { meta: { versionId: '1', lastUpdated: 'not-a-date' } }), mockCollection
            );
            expect(runner.documentsSkippedInvalidLastUpdated).toBe(1);
            expect(mockAdminLogger.logError).toHaveBeenCalled();
        });

        test('dry run counts a migration without touching cloud storage or mongo', async () => {
            const runner = new MigrateBinaryDataToCloudStorageRunner(baseParams({ dryRun: true, base64FieldCloudStorageClient: undefined }));
            await runner.processRecordAsync(makeBinaryDoc('u4'), mockCollection);
            expect(runner.documentsMigrated).toBe(1);
            expect(mockCloudStorageClient.uploadAsync).not.toHaveBeenCalled();
        });

        test('uploads the data and clears it from mongo on success', async () => {
            const runner = new MigrateBinaryDataToCloudStorageRunner(baseParams({}));
            wireMongo([]);
            mockCollection.updateOne.mockResolvedValue({ matchedCount: 1 });
            await runner.processRecordAsync(makeBinaryDoc('u5'), mockCollection);

            expect(mockCloudStorageClient.uploadAsync).toHaveBeenCalledWith(
                expect.objectContaining({ filePath: 'Binary_4_0_0/u5/1704164645000', ifNoneMatch: true })
            );
            const updateArgs = mockCollection.updateOne.mock.calls[0];
            expect(updateArgs[1].$unset).toEqual({ data: '' });
            expect(updateArgs[1].$set._blobMeta.rawSize).toBeGreaterThan(0);
            expect(runner.documentsMigrated).toBe(1);
        });

        test('a live-key collision that matches this document\'s own hash resumes instead of skipping', async () => {
            const runner = new MigrateBinaryDataToCloudStorageRunner(baseParams({}));
            wireMongo([]);
            mockCloudStorageClient.uploadAsync.mockResolvedValue(null);
            const doc = makeBinaryDoc('u6');
            mockCloudStorageClient.downloadAsync.mockResolvedValue(doc.data);
            mockCollection.updateOne.mockResolvedValue({ matchedCount: 1 });

            await runner.processRecordAsync(doc, mockCollection);

            expect(runner.documentsMigrated).toBe(1);
            expect(runner.documentsSkippedKeyCollision).toBe(0);
        });

        test('a live-key collision belonging to someone else is skipped, not overwritten', async () => {
            const runner = new MigrateBinaryDataToCloudStorageRunner(baseParams({}));
            wireMongo([]);
            mockCloudStorageClient.uploadAsync.mockResolvedValue(null);
            mockCloudStorageClient.downloadAsync.mockResolvedValue('someone-elses-data');

            await runner.processRecordAsync(makeBinaryDoc('u7'), mockCollection);

            expect(runner.documentsSkippedKeyCollision).toBe(1);
            expect(mockCollection.updateOne).not.toHaveBeenCalled();
        });

        test('retries on a version conflict (matchedCount 0) using the refreshed document, then succeeds', async () => {
            const runner = new MigrateBinaryDataToCloudStorageRunner(baseParams({}));
            wireMongo([]);
            const originalDoc = makeBinaryDoc('u8');
            const refreshedDoc = makeBinaryDoc('u8', { meta: { versionId: '2', lastUpdated: '2024-02-02T00:00:00.000Z' } });
            mockCollection.updateOne
                .mockResolvedValueOnce({ matchedCount: 0 })
                .mockResolvedValueOnce({ matchedCount: 1 });
            mockCollection.findOne.mockResolvedValue(refreshedDoc);

            await runner.processRecordAsync(originalDoc, mockCollection);

            expect(runner.documentsVersionConflictRetries).toBe(1);
            expect(runner.documentsMigrated).toBe(1);
            expect(mockCloudStorageClient.deleteAsync).toHaveBeenCalledWith('Binary_4_0_0/u8/1704164645000');
        });

        test('exhausts retries when every attempt hits a version conflict', async () => {
            const runner = new MigrateBinaryDataToCloudStorageRunner(baseParams({}));
            wireMongo([]);
            mockCollection.updateOne.mockResolvedValue({ matchedCount: 0 });
            mockCollection.findOne.mockResolvedValue(makeBinaryDoc('u9'));

            await runner.processRecordAsync(makeBinaryDoc('u9'), mockCollection);

            expect(runner.documentsFailed).toBe(1);
            expect(mockAdminLogger.logError).toHaveBeenCalledWith(expect.stringContaining('Exhausted retries'));
        });

        test('a deleted document (findOne returns null after a conflict) is counted as skipped, not failed', async () => {
            const runner = new MigrateBinaryDataToCloudStorageRunner(baseParams({}));
            wireMongo([]);
            mockCollection.updateOne.mockResolvedValue({ matchedCount: 0 });
            mockCollection.findOne.mockResolvedValue(null);

            await runner.processRecordAsync(makeBinaryDoc('u10'), mockCollection);

            expect(runner.documentsSkippedDeleted).toBe(1);
            expect(runner.documentsFailed).toBe(0);
        });

        test('an upload failure is counted as failed and does not touch mongo', async () => {
            const runner = new MigrateBinaryDataToCloudStorageRunner(baseParams({}));
            wireMongo([]);
            mockCloudStorageClient.uploadAsync.mockRejectedValue(new Error('S3 down'));

            await runner.processRecordAsync(makeBinaryDoc('u11'), mockCollection);

            expect(runner.documentsFailed).toBe(1);
            expect(mockCollection.updateOne).not.toHaveBeenCalled();
        });
    });

    // =====================================================
    // processBatch
    // =====================================================
    describe('processBatch', () => {
        test('one failing document does not stop the rest of the batch from being processed', async () => {
            const runner = new MigrateBinaryDataToCloudStorageRunner(baseParams({ dryRun: true, base64FieldCloudStorageClient: undefined }));
            runner.currentBatch = [
                makeBinaryDoc('good-1'),
                { _id: 'bad', _uuid: 'bad', resourceType: 'Binary', data: 'x'.repeat(2048), meta: null },
                makeBinaryDoc('good-2')
            ];

            await runner.processBatch(mockCollection);

            expect(runner.documentsMigrated).toBe(2);
            expect(runner.documentsFailed).toBe(1);
            expect(runner.currentBatch).toEqual([]);
        });
    });

    // =====================================================
    // processAsync
    // =====================================================
    describe('processAsync', () => {
        test('migrates matching documents end to end and always cleans up the session/client', async () => {
            const runner = new MigrateBinaryDataToCloudStorageRunner(baseParams({ dryRun: true, base64FieldCloudStorageClient: undefined, batchSize: 10 }));
            wireMongo([makeBinaryDoc('a1'), makeBinaryDoc('a2')]);

            await runner.processAsync();

            expect(runner.documentsMigrated).toBe(2);
            expect(mockMongoDatabaseManager.disconnectClientAsync).toHaveBeenCalledWith(mockClient);
        });

        test('an explicit --count 0 must migrate zero documents, not the whole collection', async () => {
            // migrateBinaryDataToCloudStorageRunner.js processAsync: `if (this.count) { cursor =
            // cursor.limit(this.count); }` treats 0 as falsy, so passing --count 0 (a legitimate way
            // to ask the script to touch nothing) silently falls through to an unlimited scan instead.
            const runner = new MigrateBinaryDataToCloudStorageRunner(
                baseParams({ dryRun: true, base64FieldCloudStorageClient: undefined, count: 0 })
            );
            wireMongo([makeBinaryDoc('should-not-be-touched')]);

            await runner.processAsync();

            // CORRECT behaviour: --count 0 means "process nothing".
            expect(runner.documentsMigrated).toBe(0);
        });

        test('releases the mongo session and client even when an unexpected error is thrown', async () => {
            const runner = new MigrateBinaryDataToCloudStorageRunner(baseParams({}));
            wireMongo([]);
            mockCollection.find = jestGlobal.fn(() => { throw new Error('cursor blew up'); });

            await expect(runner.processAsync()).rejects.toThrow(/Error migrating Binary data/);

            expect(mockMongoDatabaseManager.disconnectClientAsync).toHaveBeenCalledWith(mockClient);
        });

        test('reports requested --ids that never matched the eligibility criteria', async () => {
            const runner = new MigrateBinaryDataToCloudStorageRunner(
                baseParams({ dryRun: true, base64FieldCloudStorageClient: undefined, uuids: ['3f4c9d7e-0000-4000-8000-000000000099'] })
            );
            wireMongo([]);

            await runner.processAsync();

            expect(mockAdminLogger.logError).toHaveBeenCalledWith(
                expect.stringContaining('3f4c9d7e-0000-4000-8000-000000000099')
            );
        });

        test('caps the batch at this.count when a positive count is given', async () => {
            const runner = new MigrateBinaryDataToCloudStorageRunner(baseParams({ dryRun: true, base64FieldCloudStorageClient: undefined, count: 5 }));
            const cursor = wireMongo([]);

            await runner.processAsync();

            expect(cursor.limit).toHaveBeenCalledWith(5);
        });
    });
});
