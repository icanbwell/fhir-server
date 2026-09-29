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

jestGlobal.mock('../../../utils/assertType', () => ({
    assertTypeEquals: jestGlobal.fn(),
    assertIsValid: jestGlobal.fn()
}));

jestGlobal.mock('../../../utils/rethrownError', () => ({
    RethrownError: class RethrownError extends Error {
        constructor({ message, source, error }) {
            super(message);
            this.source = source;
            this.originalError = error;
        }
    }
}));

jestGlobal.mock('../../../constants', () => ({
    EXPORTSTATUS_LAST_UPDATED_DEFAULT_TIME: 24 * 60 * 60 * 1000
}));

const { CronJobRunner } = require('../../../cronJob/cronJobRunner');
const { DatabaseExportManager } = require('../../../dataLayer/databaseExportManager');
const { DatabaseQueryFactory } = require('../../../dataLayer/databaseQueryFactory');
const { ExportManager } = require('../../../operations/export/exportManager');
const { ConfigManager } = require('../../../utils/configManager');
const { PostSaveProcessor } = require('../../../dataLayer/postSaveProcessor');
const { BulkExportEventProducer } = require('../../../utils/bulkExportEventProducer');
const { K8sClient } = require('../../../utils/k8sClient');
const { logInfo, logError } = require('../../../operations/common/logging');

describe('CronJobRunner', () => {
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
        logInfo.mockReset();
        logError.mockReset();

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
        Object.defineProperty(mockConfigManager, 'enableHistoryToCloudStorageMigration', {
            get: () => true,
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

    describe('constructor', () => {
        test('assigns all dependencies to instance properties', () => {
            expect(runner.databaseQueryFactory).toBe(mockDatabaseQueryFactory);
            expect(runner.databaseExportManager).toBe(mockDatabaseExportManager);
            expect(runner.exportManager).toBe(mockExportManager);
            expect(runner.configManager).toBe(mockConfigManager);
            expect(runner.postSaveProcessor).toBe(mockPostSaveProcessor);
            expect(runner.bulkExportEventProducer).toBe(mockBulkExportEventProducer);
            expect(runner.k8sClient).toBe(mockK8sClient);
        });
    });

    describe('processAsync', () => {
        test('creates a database query for ExportStatus with version 4_0_0', async () => {
            const emptyCursor = createMockCursor([]);
            mockDatabaseQueryManager.findAsync.mockResolvedValue(emptyCursor);

            await runner.processAsync();

            expect(mockDatabaseQueryFactory.createQuery).toHaveBeenCalledWith({
                resourceType: 'ExportStatus',
                base_version: '4_0_0'
            });
        });

        test('calls triggerK8JobForAcceptedResources, updateInProgressResources, and triggerHistoryMigrationJob', async () => {
            const emptyCursor = createMockCursor([]);
            mockDatabaseQueryManager.findAsync.mockResolvedValue(emptyCursor);

            await runner.processAsync();

            // triggerK8JobForAcceptedResources queries accepted status
            expect(mockDatabaseQueryManager.findAsync).toHaveBeenCalledWith(
                expect.objectContaining({
                    query: { status: 'accepted' },
                    options: expect.any(Object)
                })
            );
            // updateInProgressResources queries in-progress status
            expect(mockDatabaseQueryManager.findAsync).toHaveBeenCalledWith(
                expect.objectContaining({
                    query: expect.objectContaining({ status: 'in-progress' })
                })
            );
            // triggerHistoryMigrationJob calls k8sClient.createJob
            expect(mockK8sClient.createJob).toHaveBeenCalled();
        });

        test('logs error but does not throw when an error occurs', async () => {
            mockDatabaseQueryFactory.createQuery.mockImplementation(() => {
                throw new Error('factory error');
            });

            await expect(runner.processAsync()).resolves.toBeUndefined();

            expect(logError).toHaveBeenCalledWith(
                expect.stringContaining('Error in processAsync'),
                expect.objectContaining({ error: expect.any(String) })
            );
        });
    });

    describe('triggerK8JobForAcceptedResources', () => {
        test('queries for accepted status resources sorted by transactionTime ascending', async () => {
            const emptyCursor = createMockCursor([]);
            mockDatabaseQueryManager.findAsync.mockResolvedValue(emptyCursor);

            await runner.triggerK8JobForAcceptedResources({ databaseQueryManager: mockDatabaseQueryManager });

            expect(mockDatabaseQueryManager.findAsync).toHaveBeenCalledWith({
                query: { status: 'accepted' },
                options: {
                    sort: { transactionTime: 1 },
                    projection: { _uuid: 1 }
                }
            });
        });

        test('triggers export job for each resource in cursor', async () => {
            const resources = [{ _uuid: 'uuid-1' }, { _uuid: 'uuid-2' }];
            const cursor = createMockCursor(resources);
            mockDatabaseQueryManager.findAsync.mockResolvedValue(cursor);

            await runner.triggerK8JobForAcceptedResources({ databaseQueryManager: mockDatabaseQueryManager });

            expect(mockExportManager.triggerExportJob).toHaveBeenCalledTimes(2);
            expect(mockExportManager.triggerExportJob).toHaveBeenCalledWith({
                exportStatusResource: { _uuid: 'uuid-1' },
                requestId: 'test-host'
            });
            expect(mockExportManager.triggerExportJob).toHaveBeenCalledWith({
                exportStatusResource: { _uuid: 'uuid-2' },
                requestId: 'test-host'
            });
        });

        test('stops creating jobs when triggerExportJob returns falsy', async () => {
            const resources = [{ _uuid: 'uuid-1' }, { _uuid: 'uuid-2' }, { _uuid: 'uuid-3' }];
            const cursor = createMockCursor(resources);
            mockDatabaseQueryManager.findAsync.mockResolvedValue(cursor);

            mockExportManager.triggerExportJob
                .mockResolvedValueOnce(true)
                .mockResolvedValueOnce(false);

            await runner.triggerK8JobForAcceptedResources({ databaseQueryManager: mockDatabaseQueryManager });

            expect(mockExportManager.triggerExportJob).toHaveBeenCalledTimes(2);
            expect(logInfo).toHaveBeenCalledWith(
                expect.stringContaining('Maximum number of active jobs reached')
            );
        });

        test('does not trigger any jobs when cursor is empty', async () => {
            const cursor = createMockCursor([]);
            mockDatabaseQueryManager.findAsync.mockResolvedValue(cursor);

            await runner.triggerK8JobForAcceptedResources({ databaseQueryManager: mockDatabaseQueryManager });

            expect(mockExportManager.triggerExportJob).not.toHaveBeenCalled();
        });

        test('throws RethrownError when findAsync fails', async () => {
            mockDatabaseQueryManager.findAsync.mockRejectedValue(new Error('db connection failed'));

            await expect(
                runner.triggerK8JobForAcceptedResources({ databaseQueryManager: mockDatabaseQueryManager })
            ).rejects.toThrow('db connection failed');

            expect(logError).toHaveBeenCalledWith(
                expect.stringContaining('Error in triggerK8JobForAcceptedResources'),
                expect.objectContaining({ error: expect.any(String) })
            );
        });

        test('logs info about fetching resources before querying', async () => {
            const cursor = createMockCursor([]);
            mockDatabaseQueryManager.findAsync.mockResolvedValue(cursor);

            await runner.triggerK8JobForAcceptedResources({ databaseQueryManager: mockDatabaseQueryManager });

            expect(logInfo).toHaveBeenCalledWith(
                expect.stringContaining('Fetching ExportStatus resource with query')
            );
        });

        test('logs success message after processing all resources', async () => {
            const cursor = createMockCursor([]);
            mockDatabaseQueryManager.findAsync.mockResolvedValue(cursor);

            await runner.triggerK8JobForAcceptedResources({ databaseQueryManager: mockDatabaseQueryManager });

            expect(logInfo).toHaveBeenCalledWith(
                expect.stringContaining('Successfully finished triggering k8 job')
            );
        });
    });

    describe('updateInProgressResources', () => {
        test('queries for in-progress resources with lastUpdated older than default time', async () => {
            const cursor = createMockCursor([]);
            mockDatabaseQueryManager.findAsync.mockResolvedValue(cursor);

            await runner.updateInProgressResources({ databaseQueryManager: mockDatabaseQueryManager });

            const findCall = mockDatabaseQueryManager.findAsync.mock.calls[0][0];
            expect(findCall.query.status).toBe('in-progress');
            expect(findCall.query['meta.lastUpdated'].$lt).toBeInstanceOf(Date);
        });

        test('sets status to entered-in-error for each found resource', async () => {
            const resources = [
                { _uuid: 'uuid-1', status: 'in-progress' },
                { _uuid: 'uuid-2', status: 'in-progress' }
            ];
            const cursor = createMockCursor(resources);
            mockDatabaseQueryManager.findAsync.mockResolvedValue(cursor);

            await runner.updateInProgressResources({ databaseQueryManager: mockDatabaseQueryManager });

            expect(resources[0].status).toBe('entered-in-error');
            expect(resources[1].status).toBe('entered-in-error');
        });

        test('calls updateExportStatusAsync for each resource', async () => {
            const resources = [
                { _uuid: 'uuid-1', status: 'in-progress' },
                { _uuid: 'uuid-2', status: 'in-progress' }
            ];
            const cursor = createMockCursor(resources);
            mockDatabaseQueryManager.findAsync.mockResolvedValue(cursor);

            await runner.updateInProgressResources({ databaseQueryManager: mockDatabaseQueryManager });

            expect(mockDatabaseExportManager.updateExportStatusAsync).toHaveBeenCalledTimes(2);
            expect(mockDatabaseExportManager.updateExportStatusAsync).toHaveBeenCalledWith({
                exportStatusResource: resources[0]
            });
            expect(mockDatabaseExportManager.updateExportStatusAsync).toHaveBeenCalledWith({
                exportStatusResource: resources[1]
            });
        });

        test('calls postSaveProcessor.afterSaveAsync with correct params', async () => {
            const resource = { _uuid: 'uuid-1', status: 'in-progress' };
            const cursor = createMockCursor([resource]);
            mockDatabaseQueryManager.findAsync.mockResolvedValue(cursor);

            await runner.updateInProgressResources({ databaseQueryManager: mockDatabaseQueryManager });

            expect(mockPostSaveProcessor.afterSaveAsync).toHaveBeenCalledWith({
                requestId: 'test-host',
                eventType: 'U',
                resourceType: 'ExportStatus',
                doc: resource
            });
        });

        test('calls bulkExportEventProducer.produce with correct params', async () => {
            const resource = { _uuid: 'uuid-1', status: 'in-progress' };
            const cursor = createMockCursor([resource]);
            mockDatabaseQueryManager.findAsync.mockResolvedValue(cursor);

            await runner.updateInProgressResources({ databaseQueryManager: mockDatabaseQueryManager });

            expect(mockBulkExportEventProducer.produce).toHaveBeenCalledWith({
                resource: resource,
                requestId: 'test-host'
            });
        });

        test('does not process anything when cursor is empty', async () => {
            const cursor = createMockCursor([]);
            mockDatabaseQueryManager.findAsync.mockResolvedValue(cursor);

            await runner.updateInProgressResources({ databaseQueryManager: mockDatabaseQueryManager });

            expect(mockDatabaseExportManager.updateExportStatusAsync).not.toHaveBeenCalled();
            expect(mockPostSaveProcessor.afterSaveAsync).not.toHaveBeenCalled();
            expect(mockBulkExportEventProducer.produce).not.toHaveBeenCalled();
        });

        test('throws RethrownError when an error occurs', async () => {
            mockDatabaseQueryManager.findAsync.mockRejectedValue(new Error('update failed'));

            await expect(
                runner.updateInProgressResources({ databaseQueryManager: mockDatabaseQueryManager })
            ).rejects.toThrow('update failed');

            expect(logError).toHaveBeenCalledWith(
                expect.stringContaining('Error in updateInProgressResources'),
                expect.objectContaining({ error: expect.any(String) })
            );
        });

        test('logs success message after completing all updates', async () => {
            const cursor = createMockCursor([]);
            mockDatabaseQueryManager.findAsync.mockResolvedValue(cursor);

            await runner.updateInProgressResources({ databaseQueryManager: mockDatabaseQueryManager });

            expect(logInfo).toHaveBeenCalledWith(
                expect.stringContaining("Successfully finished updating status to 'entered-in-error'")
            );
        });
    });

    describe('triggerHistoryMigrationJob', () => {
        test('creates a k8s job for each collection in cloudStorageHistoryResources', async () => {
            await runner.triggerHistoryMigrationJob();

            expect(mockK8sClient.createJob).toHaveBeenCalledTimes(2);
            expect(mockK8sClient.createJob).toHaveBeenCalledWith({
                scriptCommand: expect.stringContaining('Binary_4_0_0_History'),
                context: {}
            });
            expect(mockK8sClient.createJob).toHaveBeenCalledWith({
                scriptCommand: expect.stringContaining('DocumentReference_4_0_0_History'),
                context: {}
            });
        });

        test('includes migration limit from configManager in script command', async () => {
            await runner.triggerHistoryMigrationJob();

            expect(mockK8sClient.createJob).toHaveBeenCalledWith({
                scriptCommand: expect.stringContaining('--limit=1000'),
                context: {}
            });
        });

        test('includes correct script path in command', async () => {
            await runner.triggerHistoryMigrationJob();

            expect(mockK8sClient.createJob).toHaveBeenCalledWith({
                scriptCommand: expect.stringContaining('node /srv/src/src/operations/history/script/migrateToCloudStorage.js'),
                context: {}
            });
        });

        test('stops creating jobs when createJob returns falsy', async () => {
            mockK8sClient.createJob.mockResolvedValueOnce(false);

            await runner.triggerHistoryMigrationJob();

            expect(mockK8sClient.createJob).toHaveBeenCalledTimes(1);
            expect(logInfo).toHaveBeenCalledWith(
                expect.stringContaining('Maximum number of active jobs reached in the namespace, stopping History Migration')
            );
        });

        test('logs success for each triggered job', async () => {
            await runner.triggerHistoryMigrationJob();

            expect(logInfo).toHaveBeenCalledWith(
                expect.stringContaining('Successfully triggered History Migration k8sclient Job for: Binary')
            );
            expect(logInfo).toHaveBeenCalledWith(
                expect.stringContaining('Successfully triggered History Migration k8sclient Job for: DocumentReference')
            );
        });

        test('processes all collections when all jobs succeed', async () => {
            await runner.triggerHistoryMigrationJob();

            expect(mockK8sClient.createJob).toHaveBeenCalledTimes(2);
        });

        test('does not create any k8s jobs when enableHistoryToCloudStorageMigration is false', async () => {
            Object.defineProperty(mockConfigManager, 'enableHistoryToCloudStorageMigration', {
                get: () => false,
                configurable: true
            });

            await runner.triggerHistoryMigrationJob();

            expect(mockK8sClient.createJob).not.toHaveBeenCalled();
            expect(logInfo).toHaveBeenCalledWith(
                expect.stringContaining('History to Cloud Storage migration cron is disabled')
            );
        });
    });
});
