const { describe, beforeEach, afterEach, test, expect, jest } = require('@jest/globals');

const { commonBeforeEach, commonAfterEach, createTestRequest, getTestContainer } = require('../../common');
const {
    MigrateBinaryDataToCloudStorageRunner
} = require('../../../../admin/runners/migrateBinaryDataToCloudStorageRunner');
const { AdminLogger } = require('../../../../admin/adminLogger');
const { MockS3Client } = require('../../export/mocks/s3Client');

describe('MigrateBinaryDataToCloudStorageRunner processAsync', () => {
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
            batchSize: 3,
            concurrency: 2,
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

    const seedBinaries = async (n, { large = true } = {}) => {
        const ids = [];
        for (let i = 0; i < n; i++) {
            const insertResult = await collection.insertOne({
                _uuid: `uuid-${i}`,
                resourceType: 'Binary',
                meta: { versionId: '1', lastUpdated: new Date(`2024-01-0${i + 1}T00:00:00Z`) },
                data: large ? 'X'.repeat(2000) : 'y'
            });
            ids.push(insertResult.insertedId);
        }
        return ids;
    };

    test('migrates all qualifying documents across multiple batches', async () => {
        await seedBinaries(7);
        const runner = buildRunner();

        await runner.processAsync();

        expect(runner.documentsMigrated).toBe(7);
        const remaining = await collection.countDocuments({ data: { $exists: true } });
        expect(remaining).toBe(0);
    });

    test('leaves documents below threshold untouched', async () => {
        await seedBinaries(2, { large: false });
        const runner = buildRunner();

        await runner.processAsync();

        expect(runner.documentsMigrated).toBe(0);
        const stillInline = await collection.countDocuments({ data: { $exists: true } });
        expect(stillInline).toBe(2);
    });

    test('resumes from startId', async () => {
        const ids = await seedBinaries(4);
        const firstRunner = buildRunner({ count: 2 });
        await firstRunner.processAsync();
        expect(firstRunner.documentsMigrated).toBe(2);

        const secondRunner = buildRunner({ startId: firstRunner.lastProcessedId.toHexString() });
        await secondRunner.processAsync();
        expect(secondRunner.documentsMigrated).toBe(2);

        const remaining = await collection.countDocuments({ data: { $exists: true } });
        expect(remaining).toBe(0);
        expect(ids.length).toBe(4);
    });

    test('cleans up Mongo client and session on error in processBatch', async () => {
        await seedBinaries(5);
        const container = getTestContainer();
        const runner = buildRunner();

        const disconnectSpy = jest.spyOn(container.mongoDatabaseManager, 'disconnectClientAsync');
        disconnectSpy.mockResolvedValue(undefined);

        runner.processBatch = async () => {
            throw new Error('Simulated processBatch error');
        };

        await expect(runner.processAsync()).rejects.toThrow('Error migrating Binary data to cloud storage: Simulated processBatch error');

        expect(disconnectSpy).toHaveBeenCalled();
        disconnectSpy.mockRestore();
    });
});
