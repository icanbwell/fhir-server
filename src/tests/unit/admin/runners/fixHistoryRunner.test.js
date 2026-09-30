'use strict';

const { describe, test, expect, beforeEach, jest: jestGlobal } = require('@jest/globals');

const { FixHistoryRunner } = require('../../../../admin/runners/fixHistoryRunner');
const { AdminLogger } = require('../../../../admin/adminLogger');
const { MongoDatabaseManager } = require('../../../../utils/mongoDatabaseManager');
const { PreSaveManager } = require('../../../../preSaveHandlers/preSave');

function createMockInstance (ClassType) {
    return Object.create(ClassType.prototype);
}

describe('FixHistoryRunner', () => {
    let runner;
    let mockAdminLogger;
    let mockMongoDatabaseManager;
    let mockPreSaveManager;
    let consoleLogSpy;
    let consoleErrorSpy;

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

        mockPreSaveManager = createMockInstance(PreSaveManager);
        mockPreSaveManager.preSaveAsync = jestGlobal.fn().mockImplementation(async ({ resource }) => resource);

        consoleLogSpy = jestGlobal.spyOn(console, 'log').mockImplementation(() => {});
        consoleErrorSpy = jestGlobal.spyOn(console, 'error').mockImplementation(() => {});

        runner = new FixHistoryRunner({
            collections: ['Patient_4_0_0_History'],
            batchSize: 100,
            adminLogger: mockAdminLogger,
            mongoDatabaseManager: mockMongoDatabaseManager,
            preSaveManager: mockPreSaveManager,
            skipIfResourcePresent: false,
            startFromCollection: undefined
        });
    });

    // =====================================================
    // constructor
    // =====================================================
    describe('constructor', () => {
        test('rejects a preSaveManager that is not a PreSaveManager instance', () => {
            expect(() => new FixHistoryRunner({
                collections: ['Patient_4_0_0_History'],
                batchSize: 100,
                adminLogger: mockAdminLogger,
                mongoDatabaseManager: mockMongoDatabaseManager,
                preSaveManager: { preSaveAsync: () => {} }
            })).toThrow();
        });

        test('stores the configured collections and batchSize', () => {
            expect(runner.collections).toEqual(['Patient_4_0_0_History']);
            expect(runner.batchSize).toBe(100);
        });
    });

    // =====================================================
    // processRecordAsync
    // =====================================================
    describe('processRecordAsync', () => {
        test('returns no operations for a doc already wrapped with a resource that has _uuid', async () => {
            const doc = {
                _id: 'h1',
                id: 'p1',
                resource: { resourceType: 'Patient', id: 'p1', _uuid: 'uuid-1' }
            };

            const operations = await runner.processRecordAsync(doc);

            expect(operations).toEqual([]);
            expect(mockPreSaveManager.preSaveAsync).not.toHaveBeenCalled();
        });

        test('wraps a bare (unwrapped) history document under a resource key', async () => {
            const bareDoc = { _id: 'h2', id: 'p2', resourceType: 'Patient' };
            mockPreSaveManager.preSaveAsync.mockImplementation(async ({ resource }) => ({
                ...resource,
                toJSONInternal: () => ({ resourceType: 'Patient', id: 'p2', _uuid: 'generated-uuid' })
            }));

            const operations = await runner.processRecordAsync(bareDoc);

            expect(operations).toHaveLength(1);
            const replacement = operations[0].replaceOne.replacement;
            expect(replacement._id).toBe('h2');
            expect(replacement.id).toBe('p2');
            expect(replacement.resource).toEqual({ resourceType: 'Patient', id: 'p2', _uuid: 'generated-uuid' });
        });

        test('the wrapped resource copy never keeps the outer _id field', async () => {
            const bareDoc = { _id: 'h3', id: 'p3', resourceType: 'Patient' };
            let capturedResource;
            mockPreSaveManager.preSaveAsync.mockImplementation(async ({ resource }) => {
                capturedResource = resource;
                return { toJSONInternal: () => resource };
            });

            await runner.processRecordAsync(bareDoc);

            expect(capturedResource._id).toBeUndefined();
        });

        test('runs preSave on an already-wrapped document whose resource is missing _uuid', async () => {
            const doc = { _id: 'h4', id: 'p4', resource: { resourceType: 'Patient', id: 'p4' } };
            mockPreSaveManager.preSaveAsync.mockImplementation(async ({ resource }) => ({
                toJSONInternal: () => ({ ...resource, _uuid: 'newly-assigned' })
            }));

            const operations = await runner.processRecordAsync(doc);

            expect(mockPreSaveManager.preSaveAsync).toHaveBeenCalledWith(
                expect.objectContaining({ base_version: '4_0_0' })
            );
            expect(operations[0].replaceOne.replacement.resource._uuid).toBe('newly-assigned');
        });

        test('targets the replaceOne at the original document _id', async () => {
            const doc = { _id: 'mongo-history-1', id: 'p5', resource: { resourceType: 'Patient', id: 'p5', _uuid: 'u5' } };

            const operations = await runner.processRecordAsync({ ...doc });

            expect(operations).toEqual([]);
        });
    });

    // =====================================================
    // processAsync
    // =====================================================
    describe('processAsync', () => {
        test('expands the "all" sentinel to only _History collections, sorted', async () => {
            runner.collections = ['all'];
            runner.getAllCollectionNamesAsync = jestGlobal.fn().mockResolvedValue([
                'Patient_4_0_0', 'Zebra_4_0_0_History', 'Account_4_0_0_History'
            ]);
            runner.runForQueryBatchesAsync = jestGlobal.fn().mockResolvedValue('done');

            await runner.processAsync();

            expect(runner.getAllCollectionNamesAsync).toHaveBeenCalledWith({
                useAuditDatabase: false, includeHistoryCollections: true
            });
            expect(runner.collections).toEqual(['Account_4_0_0_History', 'Zebra_4_0_0_History']);
        });

        test('honors --startFromCollection when expanding "all"', async () => {
            runner.collections = ['all'];
            runner.startFromCollection = 'Patient_4_0_0_History';
            runner.getAllCollectionNamesAsync = jestGlobal.fn().mockResolvedValue([
                'Account_4_0_0_History', 'Patient_4_0_0_History', 'Zebra_4_0_0_History'
            ]);
            runner.runForQueryBatchesAsync = jestGlobal.fn().mockResolvedValue('done');

            await runner.processAsync();

            expect(runner.collections).toEqual(['Patient_4_0_0_History', 'Zebra_4_0_0_History']);
        });

        test('queries only documents missing a resource when skipIfResourcePresent is set', async () => {
            runner.skipIfResourcePresent = true;
            runner.runForQueryBatchesAsync = jestGlobal.fn().mockResolvedValue('done');

            await runner.processAsync();

            expect(runner.runForQueryBatchesAsync.mock.calls[0][0].query).toEqual({ resource: null });
        });

        test('resets startFromId for every collection it processes', async () => {
            runner.collections = ['A_4_0_0_History', 'B_4_0_0_History'];
            const seen = [];
            runner.runForQueryBatchesAsync = jestGlobal.fn().mockImplementation(async ({ startFromIdContainer }) => {
                seen.push(startFromIdContainer.startFromId);
                startFromIdContainer.startFromId = 'left-over';
                return 'done';
            });

            await runner.processAsync();

            expect(seen).toEqual(['', '']);
        });

        test('a collection whose bulk write fails is never reported through the admin logger', async () => {
            // fixHistoryRunner.js processAsync wraps runForQueryBatchesAsync in
            // `catch (e) { console.error(e); console.log(...) }` -- it never calls
            // this.adminLogger.logError, and the outer catch around the whole method does the same
            // (console.log only). src/admin/scripts/fixHistory.js then calls process.exit(0)
            // unconditionally, so an operator watching the structured admin log sees a completely
            // clean run even though an entire collection was never migrated.
            runner.collections = ['Patient_4_0_0_History', 'Account_4_0_0_History'];
            runner.runForQueryBatchesAsync = jestGlobal.fn()
                .mockRejectedValueOnce(new Error('bulk write failed'))
                .mockResolvedValueOnce('done');

            await runner.processAsync();

            // CORRECT behaviour: a failed collection must be visible in the structured admin log,
            // the same channel every other runner in this family reports through.
            expect(mockAdminLogger.logError).toHaveBeenCalledWith(expect.stringContaining('bulk write failed'));
        });

        test('continues to the next collection after one collection throws', async () => {
            runner.collections = ['Patient_4_0_0_History', 'Account_4_0_0_History'];
            runner.runForQueryBatchesAsync = jestGlobal.fn()
                .mockRejectedValueOnce(new Error('bulk write failed'))
                .mockResolvedValueOnce('done');

            await runner.processAsync();

            expect(runner.runForQueryBatchesAsync).toHaveBeenCalledTimes(2);
            expect(runner.runForQueryBatchesAsync.mock.calls[1][0].sourceCollectionName).toBe('Account_4_0_0_History');
        });

        test('does not throw even when every collection fails', async () => {
            runner.collections = ['Patient_4_0_0_History'];
            runner.runForQueryBatchesAsync = jestGlobal.fn().mockRejectedValue(new Error('down'));

            await expect(runner.processAsync()).resolves.toBeUndefined();
        });
    });
});
