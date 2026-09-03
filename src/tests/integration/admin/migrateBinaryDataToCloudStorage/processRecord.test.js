const { describe, beforeEach, afterEach, test, expect, jest } = require('@jest/globals');

const { commonBeforeEach, commonAfterEach, createTestRequest, getTestContainer } = require('../../common');
const {
    MigrateBinaryDataToCloudStorageRunner
} = require('../../../../admin/runners/migrateBinaryDataToCloudStorageRunner');
const { AdminLogger } = require('../../../../admin/adminLogger');
const { MockS3Client } = require('../../export/mocks/s3Client');
const { computeContentHashAsync } = require('../../../../utils/contentHash');

describe('MigrateBinaryDataToCloudStorageRunner processRecordAsync', () => {
    let collection;
    let mockS3Client;

    beforeEach(async () => {
        await commonBeforeEach();
        await createTestRequest();
        const container = getTestContainer();
        const db = await container.mongoDatabaseManager.getClientDbAsync();
        collection = db.collection('Binary_4_0_0');
        mockS3Client = new MockS3Client({
            bucketName: 'test-bucket',
            region: 'us-east-1'
        });
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    const buildRunner = (overrides = {}) => {
        const container = getTestContainer();
        return new MigrateBinaryDataToCloudStorageRunner({
            mongoDatabaseManager: container.mongoDatabaseManager,
            adminLogger: new AdminLogger(),
            batchSize: 10,
            concurrency: 5,
            thresholdKB: 1,
            startId: undefined,
            count: undefined,
            fromDate: undefined,
            toDate: undefined,
            dryRun: false,
            base64FieldCloudStorageClient: mockS3Client,
            configManager: container.configManager,
            ...overrides
        });
    };

    test('migrates a document over threshold and logs the success line', async () => {
        const runner = buildRunner();
        const logSpy = jest.spyOn(runner.adminLogger, 'logInfo');
        const largeData = 'A'.repeat(2000);
        const insertResult = await collection.insertOne({
            _uuid: 'uuid-1',
            resourceType: 'Binary',
            meta: { versionId: '1', lastUpdated: new Date('2024-01-01T00:00:00Z') },
            data: largeData
        });

        await runner.processRecordAsync(
            { _id: insertResult.insertedId, _uuid: 'uuid-1', meta: { versionId: '1', lastUpdated: new Date('2024-01-01T00:00:00Z') }, data: largeData },
            collection
        );

        const updated = await collection.findOne({ _id: insertResult.insertedId });
        expect(updated.data).toBeUndefined();
        expect(updated._blobMeta.rawSize).toBe(Math.ceil(Buffer.byteLength(largeData, 'utf8') / 1024));
        expect(updated.meta.versionId).toBe('1');
        expect(runner.documentsMigrated).toBe(1);

        const liveKey = runner._buildLiveKey('uuid-1', new Date('2024-01-01T00:00:00Z').getTime());
        expect(mockS3Client.uploadedData[liveKey]).toBeDefined();
        expect(mockS3Client.uploadedData[liveKey]).toBe(largeData);
        expect(updated._blobMeta.hash).toBe(await computeContentHashAsync(largeData));
        expect(logSpy).toHaveBeenCalledWith(
            `resource with _uuid: uuid-1 migrated with data stored at path ${liveKey}`
        );
    });

    test('dry run touches neither Mongo nor S3', async () => {
        const runner = buildRunner({ dryRun: true });
        const largeData = 'B'.repeat(2000);
        const insertResult = await collection.insertOne({
            _uuid: 'uuid-2',
            resourceType: 'Binary',
            meta: { versionId: '1', lastUpdated: new Date('2024-01-01T00:00:00Z') },
            data: largeData
        });
        const doc = await collection.findOne({ _id: insertResult.insertedId });

        await runner.processRecordAsync(doc, collection);

        const unchanged = await collection.findOne({ _id: insertResult.insertedId });
        expect(unchanged.data).toBe(largeData);
        expect(unchanged._blobMeta).toBeUndefined();
        expect(runner.documentsMigrated).toBe(1);

        expect(Object.keys(mockS3Client.uploadedData).length).toBe(0);
    });

    test('retries and cleans up the orphaned upload on a version conflict', async () => {
        const runner = buildRunner();
        const largeData = 'C'.repeat(2000);
        const insertResult = await collection.insertOne({
            _uuid: 'uuid-3',
            resourceType: 'Binary',
            meta: { versionId: '2', lastUpdated: new Date('2024-02-01T00:00:00Z') },
            data: largeData
        });

        const staleDoc = {
            _id: insertResult.insertedId,
            _uuid: 'uuid-3',
            meta: { versionId: '1', lastUpdated: new Date('2024-01-01T00:00:00Z') },
            data: largeData
        };

        await runner.processRecordAsync(staleDoc, collection);

        expect(runner.documentsVersionConflictRetries).toBe(1);
        expect(runner.documentsOrphanCleanups).toBe(1);
        expect(runner.documentsMigrated).toBe(1);

        const updated = await collection.findOne({ _id: insertResult.insertedId });
        expect(updated.data).toBeUndefined();
        expect(updated._blobMeta.lastUpdated).toEqual(new Date('2024-02-01T00:00:00Z'));

        const staleKey = runner._buildLiveKey('uuid-3', new Date('2024-01-01T00:00:00Z').getTime());
        const freshKey = runner._buildLiveKey('uuid-3', new Date('2024-02-01T00:00:00Z').getTime());
        expect(mockS3Client.uploadedData[staleKey]).toBeUndefined();
        expect(mockS3Client.uploadedData[freshKey]).toBeDefined();
    });

    test('gives up after exhausting retries and leaves no orphaned upload', async () => {
        const runner = buildRunner();
        const largeData = 'D'.repeat(2000);
        const insertResult = await collection.insertOne({
            _uuid: 'uuid-4',
            resourceType: 'Binary',
            meta: { versionId: '1', lastUpdated: new Date('2024-01-01T00:00:00Z') },
            data: largeData
        });
        const doc = await collection.findOne({ _id: insertResult.insertedId });

        const alwaysConflictingCollection = {
            updateOne: async () => ({ matchedCount: 0 }),
            findOne: async (filter) => collection.findOne(filter)
        };

        await runner.processRecordAsync(doc, alwaysConflictingCollection);

        expect(runner.documentsFailed).toBe(1);
        expect(runner.documentsMigrated).toBe(0);
        expect(runner.documentsVersionConflictRetries).toBe(3);

        expect(Object.keys(mockS3Client.uploadedData).length).toBe(0);
    });

    test('skips a document already carrying _blobMeta', async () => {
        const runner = buildRunner();
        const insertResult = await collection.insertOne({
            _uuid: 'uuid-5',
            resourceType: 'Binary',
            meta: { versionId: '1', lastUpdated: new Date('2024-01-01T00:00:00Z') },
            _blobMeta: { hash: 'existing', rawSize: 5, lastUpdated: new Date('2024-01-01T00:00:00Z') }
        });
        const doc = await collection.findOne({ _id: insertResult.insertedId });

        await runner.processRecordAsync(doc, collection);

        expect(runner.documentsSkippedAlreadyHandled).toBe(1);
        expect(runner.documentsSkippedBelowThreshold).toBe(0);
        expect(runner.documentsMigrated).toBe(0);
    });

    test('skips a below-threshold document without touching Mongo or S3', async () => {
        const runner = buildRunner();
        const smallData = 'g'.repeat(10);
        const insertResult = await collection.insertOne({
            _uuid: 'uuid-8',
            resourceType: 'Binary',
            meta: { versionId: '1', lastUpdated: new Date('2024-01-01T00:00:00Z') },
            data: smallData
        });
        const doc = await collection.findOne({ _id: insertResult.insertedId });

        await runner.processRecordAsync(doc, collection);

        expect(runner.documentsSkippedBelowThreshold).toBe(1);
        expect(runner.documentsSkippedAlreadyHandled).toBe(0);
        expect(runner.documentsMigrated).toBe(0);
        const unchanged = await collection.findOne({ _id: insertResult.insertedId });
        expect(unchanged.data).toBe(smallData);
        expect(unchanged._blobMeta).toBeUndefined();
        expect(Object.keys(mockS3Client.uploadedData).length).toBe(0);
    });

    test('skips on S3 key collision and does not delete', async () => {
        const runner = buildRunner();
        const largeData = 'E'.repeat(2000);
        const insertResult = await collection.insertOne({
            _uuid: 'uuid-6',
            resourceType: 'Binary',
            meta: { versionId: '1', lastUpdated: new Date('2024-01-01T00:00:00Z') },
            data: largeData
        });
        const doc = await collection.findOne({ _id: insertResult.insertedId });

        const liveKey = runner._buildLiveKey('uuid-6', new Date('2024-01-01T00:00:00Z').getTime());
        await mockS3Client.uploadAsync({
            filePath: liveKey, data: Buffer.from('preexisting'), ifNoneMatch: true
        });

        await runner.processRecordAsync(doc, collection);

        expect(runner.documentsSkippedKeyCollision).toBe(1);
        expect(runner.documentsMigrated).toBe(0);
        const unchanged = await collection.findOne({ _id: insertResult.insertedId });
        expect(unchanged.data).toBe(largeData);
        expect(unchanged._blobMeta).toBeUndefined();
        expect(mockS3Client.uploadedData[liveKey]).toBe('preexisting');
        expect(runner.documentsOrphanCleanups).toBe(0);
    });

    test('skips when document deleted during retry after version conflict', async () => {
        const runner = buildRunner();
        const largeData = 'F'.repeat(2000);
        const insertResult = await collection.insertOne({
            _uuid: 'uuid-7',
            resourceType: 'Binary',
            meta: { versionId: '1', lastUpdated: new Date('2024-01-01T00:00:00Z') },
            data: largeData
        });
        const doc = await collection.findOne({ _id: insertResult.insertedId });

        let findOneCallCount = 0;
        const stubbedCollection = {
            updateOne: async (filter, update) => {
                return { matchedCount: 0 };
            },
            findOne: async (filter) => {
                findOneCallCount++;
                if (findOneCallCount === 1) {
                    return collection.findOne(filter);
                }
                await collection.deleteOne({ _id: doc._id });
                return null;
            }
        };

        await runner.processRecordAsync(doc, stubbedCollection);

        expect(runner.documentsSkippedDeleted).toBe(1);
        expect(runner.documentsMigrated).toBe(0);
        expect(runner.documentsOrphanCleanups).toBe(2);
    });
});
