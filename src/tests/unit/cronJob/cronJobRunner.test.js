'use strict';

/**
 * Bug-hunting tests for CronJobRunner
 *
 * Targets:
 * 1. triggerHistoryMigrationJob: no error handling — uncaught errors crash the cron loop
 * 2. updateInProgressResources: error in mid-iteration loses remaining resources
 * 3. processAsync: triggerHistoryMigrationJob errors are NOT wrapped in RethrownError (unlike the others)
 * 4. Cursor not closed on error: cursor iteration failure leaves DB cursor open
 */
const { describe, test, beforeEach, expect, jest: jestGlobal } = require('@jest/globals');

// Mock all required modules
jestGlobal.mock('../../../operations/common/logging', () => ({
    logInfo: jestGlobal.fn(),
    logDebug: jestGlobal.fn(),
    logError: jestGlobal.fn(),
    logWarn: jestGlobal.fn()
}));

jestGlobal.mock('../../../dataLayer/databaseExportManager', () => {
    class DatabaseExportManager {
        async updateExportStatusAsync() { return; }
    }
    return { DatabaseExportManager };
});

jestGlobal.mock('../../../dataLayer/databaseQueryFactory', () => {
    class DatabaseQueryFactory {
        createQuery() { return {}; }
    }
    return { DatabaseQueryFactory };
});

jestGlobal.mock('../../../dataLayer/databaseQueryManager', () => {
    class DatabaseQueryManager {}
    return { DatabaseQueryManager };
});

jestGlobal.mock('../../../operations/export/exportManager', () => {
    class ExportManager {
        async triggerExportJob() { return {}; }
    }
    return { ExportManager };
});

jestGlobal.mock('../../../utils/configManager', () => {
    class ConfigManager {}
    return { ConfigManager };
});

jestGlobal.mock('../../../dataLayer/postSaveProcessor', () => {
    class PostSaveProcessor {
        async afterSaveAsync() { return; }
    }
    return { PostSaveProcessor };
});

jestGlobal.mock('../../../utils/bulkExportEventProducer', () => {
    class BulkExportEventProducer {
        async produce() { return; }
    }
    return { BulkExportEventProducer };
});

jestGlobal.mock('../../../utils/k8sClient', () => {
    class K8sClient {
        async createJob() { return true; }
    }
    return { K8sClient };
});

const { CronJobRunner } = require('../../../cronJob/cronJobRunner');
const { DatabaseExportManager } = require('../../../dataLayer/databaseExportManager');
const { DatabaseQueryFactory } = require('../../../dataLayer/databaseQueryFactory');
const { ExportManager } = require('../../../operations/export/exportManager');
const { ConfigManager } = require('../../../utils/configManager');
const { PostSaveProcessor } = require('../../../dataLayer/postSaveProcessor');
const { BulkExportEventProducer } = require('../../../utils/bulkExportEventProducer');
const { K8sClient } = require('../../../utils/k8sClient');

describe('CronJobRunner — Bug Detection', () => {
    let runner;
    let mockDatabaseQueryFactory;
    let mockDatabaseExportManager;
    let mockExportManager;
    let mockConfigManager;
    let mockPostSaveProcessor;
    let mockBulkExportEventProducer;
    let mockK8sClient;
    let mockDatabaseQueryManager;

    beforeEach(() => {
        mockDatabaseQueryManager = {
            findAsync: jestGlobal.fn()
        };

        mockDatabaseQueryFactory = Object.create(DatabaseQueryFactory.prototype);
        mockDatabaseQueryFactory.createQuery = jestGlobal.fn().mockReturnValue(mockDatabaseQueryManager);

        mockDatabaseExportManager = Object.create(DatabaseExportManager.prototype);
        mockDatabaseExportManager.updateExportStatusAsync = jestGlobal.fn().mockResolvedValue(undefined);

        mockExportManager = Object.create(ExportManager.prototype);
        mockExportManager.triggerExportJob = jestGlobal.fn().mockResolvedValue(true);

        mockConfigManager = Object.create(ConfigManager.prototype);
        Object.defineProperty(mockConfigManager, 'hostnameValue', {
            get: () => 'test-host',
            configurable: true
        });
        Object.defineProperty(mockConfigManager, 'cloudStorageHistoryResources', {
            get: () => ['Binary', 'DocumentReference'],
            configurable: true
        });
        Object.defineProperty(mockConfigManager, 'historyResourceCronJobMigrationLimit', {
            get: () => 1000,
            configurable: true
        });

        mockPostSaveProcessor = Object.create(PostSaveProcessor.prototype);
        mockPostSaveProcessor.afterSaveAsync = jestGlobal.fn().mockResolvedValue(undefined);

        mockBulkExportEventProducer = Object.create(BulkExportEventProducer.prototype);
        mockBulkExportEventProducer.produce = jestGlobal.fn().mockResolvedValue(undefined);

        mockK8sClient = Object.create(K8sClient.prototype);
        mockK8sClient.createJob = jestGlobal.fn().mockResolvedValue(true);

        runner = new CronJobRunner({
            databaseQueryFactory: mockDatabaseQueryFactory,
            databaseExportManager: mockDatabaseExportManager,
            exportManager: mockExportManager,
            configManager: mockConfigManager,
            postSaveProcessor: mockPostSaveProcessor,
            bulkExportEventProducer: mockBulkExportEventProducer,
            k8sClient: mockK8sClient
        });
    });

    function createMockCursor(items) {
        let index = 0;
        return {
            hasNext: jestGlobal.fn().mockImplementation(async () => index < items.length),
            nextObject: jestGlobal.fn().mockImplementation(async () => items[index++])
        };
    }

    describe('BUG: triggerHistoryMigrationJob has no try-catch — errors propagate to processAsync', () => {
        /**
         * BUG: Lines 98-119: triggerHistoryMigrationJob() has NO try-catch.
         * Unlike triggerK8JobForAcceptedResources (line 129-176) and
         * updateInProgressResources (line 185-230) which both wrap errors in RethrownError,
         * triggerHistoryMigrationJob lets errors escape raw.
         *
         * In processAsync (line 81-96), the error is caught by the outer try-catch
         * and only logged. This means:
         * - Errors are not wrapped in RethrownError (inconsistent error handling)
         * - The raw error message may not include sufficient context for debugging
         * - If k8sClient.createJob throws, the remaining collections are skipped silently
         */
        test('k8sClient.createJob throwing mid-loop skips remaining collections', async () => {
            // First call succeeds, second throws
            mockK8sClient.createJob
                .mockResolvedValueOnce(true)
                .mockRejectedValueOnce(new Error('K8s API unavailable'));

            // triggerHistoryMigrationJob iterates over ['Binary', 'DocumentReference']
            // First iteration succeeds, second throws
            await expect(
                runner.triggerHistoryMigrationJob()
            ).rejects.toThrow('K8s API unavailable');

            // BUG: Only 2 calls were made (Binary succeeded, DocumentReference threw)
            // The error is NOT caught inside triggerHistoryMigrationJob
            expect(mockK8sClient.createJob).toHaveBeenCalledTimes(2);
        });

        test('processAsync catches raw error from triggerHistoryMigrationJob (no RethrownError wrapping)', async () => {
            // Make triggerK8JobForAcceptedResources and updateInProgressResources succeed
            const emptyCursor = createMockCursor([]);
            mockDatabaseQueryManager.findAsync.mockResolvedValue(emptyCursor);

            // Make k8sClient.createJob throw
            mockK8sClient.createJob.mockRejectedValue(new Error('K8s API timeout'));

            // processAsync should NOT throw (it catches errors)
            await expect(runner.processAsync()).resolves.toBeUndefined();

            // BUG CONTEXT: The error logged in processAsync is a raw Error,
            // not wrapped in RethrownError with source context.
            // This makes it harder to trace in production logs.
        });
    });

    describe('BUG: updateInProgressResources — error during iteration leaves cursor open', () => {
        /**
         * BUG: Lines 197-217: The while loop iterates a cursor.
         * If any step inside the loop throws (updateExportStatusAsync, afterSaveAsync, produce),
         * the error propagates to the catch block, but the cursor is never explicitly closed.
         *
         * This leaks a database cursor, which can exhaust MongoDB's cursor limit
         * under sustained error conditions.
         */
        test('error mid-iteration in updateInProgressResources aborts remaining resources', async () => {
            const resources = [
                { _uuid: 'export-1', status: 'in-progress' },
                { _uuid: 'export-2', status: 'in-progress' },
                { _uuid: 'export-3', status: 'in-progress' }
            ];
            const cursor = createMockCursor(resources);
            mockDatabaseQueryManager.findAsync.mockResolvedValue(cursor);

            // First resource: updateExportStatusAsync succeeds
            // Second resource: updateExportStatusAsync throws
            mockDatabaseExportManager.updateExportStatusAsync
                .mockResolvedValueOnce(undefined)
                .mockRejectedValueOnce(new Error('MongoDB write concern timeout'));

            await expect(
                runner.updateInProgressResources({ databaseQueryManager: mockDatabaseQueryManager })
            ).rejects.toThrow('MongoDB write concern timeout');

            // BUG: Only 2 resources processed (first succeeded, second threw)
            // Third resource is never processed. Cursor is never closed.
            expect(mockDatabaseExportManager.updateExportStatusAsync).toHaveBeenCalledTimes(2);
            // export-3 was never processed — data left in inconsistent state
        });

        test('bulkExportEventProducer.produce failure aborts remaining resources', async () => {
            const resources = [
                { _uuid: 'export-1', status: 'in-progress' },
                { _uuid: 'export-2', status: 'in-progress' }
            ];
            const cursor = createMockCursor(resources);
            mockDatabaseQueryManager.findAsync.mockResolvedValue(cursor);

            // updateExportStatusAsync succeeds for both
            mockDatabaseExportManager.updateExportStatusAsync.mockResolvedValue(undefined);
            // afterSaveAsync succeeds for both
            mockPostSaveProcessor.afterSaveAsync.mockResolvedValue(undefined);
            // First produce succeeds, second throws
            mockBulkExportEventProducer.produce
                .mockResolvedValueOnce(undefined)
                .mockRejectedValueOnce(new Error('Kafka unavailable'));

            await expect(
                runner.updateInProgressResources({ databaseQueryManager: mockDatabaseQueryManager })
            ).rejects.toThrow('Kafka unavailable');

            // BUG: First resource was fully processed (status changed + event produced)
            // Second resource had its status changed in DB but event production failed
            // This leaves the second resource in 'entered-in-error' state in MongoDB
            // but without a corresponding Kafka event — downstream systems miss the state change
            expect(mockDatabaseExportManager.updateExportStatusAsync).toHaveBeenCalledTimes(2);
            expect(mockBulkExportEventProducer.produce).toHaveBeenCalledTimes(2);
        });
    });

    describe('BUG: triggerK8JobForAcceptedResources — cursor.nextObject() failure', () => {
        /**
         * If the cursor's nextObject() throws mid-iteration (e.g., network error),
         * the error is caught and wrapped in RethrownError.
         * But previously processed resources may have already had jobs triggered.
         */
        test('cursor error after triggering some jobs leaves partial state', async () => {
            let callCount = 0;
            const cursor = {
                hasNext: jestGlobal.fn().mockImplementation(async () => {
                    callCount++;
                    if (callCount === 1) return true;
                    if (callCount === 2) return true;
                    return false;
                }),
                nextObject: jestGlobal.fn()
                    .mockResolvedValueOnce({ _uuid: 'export-1' })
                    .mockRejectedValueOnce(new Error('cursor expired'))
            };
            mockDatabaseQueryManager.findAsync.mockResolvedValue(cursor);

            await expect(
                runner.triggerK8JobForAcceptedResources({ databaseQueryManager: mockDatabaseQueryManager })
            ).rejects.toThrow();

            // First export had job triggered, then cursor error prevented further processing
            expect(mockExportManager.triggerExportJob).toHaveBeenCalledTimes(1);
        });
    });

    describe('BUG: updateInProgressResources partial commit — DB updated but event fails', () => {
        /**
         * BUG: Lines 203-213: Three operations are performed sequentially per resource:
         * 1. updateExportStatusAsync (MongoDB write)
         * 2. afterSaveAsync (post-save processing)
         * 3. produce (Kafka event)
         *
         * If step 2 (afterSaveAsync) throws, the MongoDB write (step 1) is already committed.
         * The resource status is changed to 'entered-in-error' in MongoDB,
         * but the post-save event and Kafka event are lost.
         */
        test('afterSaveAsync failure after DB update creates inconsistent state', async () => {
            const resources = [{ _uuid: 'export-1', status: 'in-progress' }];
            const cursor = createMockCursor(resources);
            mockDatabaseQueryManager.findAsync.mockResolvedValue(cursor);

            mockDatabaseExportManager.updateExportStatusAsync.mockResolvedValue(undefined);
            mockPostSaveProcessor.afterSaveAsync.mockRejectedValue(
                new Error('Post-save handler crash')
            );

            await expect(
                runner.updateInProgressResources({ databaseQueryManager: mockDatabaseQueryManager })
            ).rejects.toThrow('Post-save handler crash');

            // BUG: MongoDB was updated (status = 'entered-in-error') but:
            // - afterSaveAsync failed (post-save event lost)
            // - produce was never called (Kafka event lost)
            expect(mockDatabaseExportManager.updateExportStatusAsync).toHaveBeenCalledTimes(1);
            expect(mockPostSaveProcessor.afterSaveAsync).toHaveBeenCalledTimes(1);
            expect(mockBulkExportEventProducer.produce).not.toHaveBeenCalled();
        });
    });
});
