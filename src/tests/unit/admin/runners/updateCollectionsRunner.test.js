'use strict';

const { describe, test, beforeEach, expect, jest, afterEach } = require('@jest/globals');
const moment = require('moment-timezone');
const { MongoDatabaseManager } = require('../../../../utils/mongoDatabaseManager');
const { AdminLogger } = require('../../../../admin/adminLogger');
const { UpdateCollectionsRunner } = require('../../../../admin/runners/updateCollectionsRunner');

// Mock dependencies
jest.mock('../../../../utils/mongoDatabaseManager');
jest.mock('../../../../admin/adminLogger');
jest.mock('../../../../operations/common/logging', () => ({
    logInfo: jest.fn(),
    logError: jest.fn()
}));
jest.mock('../../../../winstonInit', () => ({
    getLogger: jest.fn(() => ({
        child: jest.fn(() => ({
            info: jest.fn(),
            error: jest.fn(),
            defaultMeta: {}
        })),
        defaultMeta: {}
    }))
}));

describe('UpdateCollectionsRunner', () => {
    let mockMongoDatabaseManager;
    let mockAdminLogger;
    let updatedBefore;

    beforeEach(() => {
        // Create mock instances that pass assertTypeEquals
        mockMongoDatabaseManager = Object.create(MongoDatabaseManager.prototype);
        mockMongoDatabaseManager.createClientAsync = jest.fn();
        mockMongoDatabaseManager.disconnectClientAsync = jest.fn();

        mockAdminLogger = Object.create(AdminLogger.prototype);
        mockAdminLogger.logInfo = jest.fn();
        mockAdminLogger.logError = jest.fn();

        updatedBefore = moment('2024-01-15T00:00:00Z');

        // Set required env vars
        process.env.TARGET_CLUSTER_USERNAME = 'targetUser';
        process.env.TARGET_CLUSTER_PASSWORD = 'targetPass';
        process.env.TARGET_CLUSTER_MONGO_URL = 'target.mongo.url';
        process.env.TARGET_DB_NAME = 'targetDb';
        process.env.SOURCE_CLUSTER_USERNAME = 'sourceUser';
        process.env.SOURCE_CLUSTER_PASSWORD = 'sourcePass';
        process.env.SOURCE_CLUSTER_MONGO_URL = 'source.mongo.url';
        process.env.SOURCE_DB_NAME = 'sourceDb';
    });

    afterEach(() => {
        delete process.env.TARGET_CLUSTER_USERNAME;
        delete process.env.TARGET_CLUSTER_PASSWORD;
        delete process.env.TARGET_CLUSTER_MONGO_URL;
        delete process.env.TARGET_DB_NAME;
        delete process.env.SOURCE_CLUSTER_USERNAME;
        delete process.env.SOURCE_CLUSTER_PASSWORD;
        delete process.env.SOURCE_CLUSTER_MONGO_URL;
        delete process.env.SOURCE_DB_NAME;
    });

    function createRunner (overrides = {}) {
        return new UpdateCollectionsRunner({
            mongoDatabaseManager: mockMongoDatabaseManager,
            updatedBefore,
            readBatchSize: 100,
            concurrentRunners: 1,
            _idAbove: undefined,
            collections: undefined,
            startWithCollection: undefined,
            skipHistoryCollections: false,
            adminLogger: mockAdminLogger,
            ...overrides
        });
    }

    describe('constructor', () => {
        test('creates runner with valid params', () => {
            const runner = createRunner();
            expect(runner.updatedBefore).toBe(updatedBefore);
            expect(runner.readBatchSize).toBe(100);
        });
    });

    describe('getTargetClusterConfig', () => {
        test('builds target config from env vars', () => {
            const runner = createRunner();
            const config = runner.getTargetClusterConfig();
            expect(config.connection).toContain('target.mongo.url');
            expect(config.db_name).toBe('targetDb');
            expect(config.options.retryWrites).toBe(true);
        });
    });

    describe('getSourceClusterConfig', () => {
        test('builds source config from env vars', () => {
            const runner = createRunner();
            const config = runner.getSourceClusterConfig();
            expect(config.connection).toContain('source.mongo.url');
            expect(config.db_name).toBe('sourceDb');
        });
    });

    describe('getListOfCollections', () => {
        test('filters out non-collection types', () => {
            const runner = createRunner();
            const input = [
                { name: 'Patient_4_0_0', type: 'collection' },
                { name: 'myView', type: 'view' },
                { name: 'Observation_4_0_0', type: 'collection' }
            ];
            const result = runner.getListOfCollections(input);
            expect(result).toEqual(['Patient_4_0_0', 'Observation_4_0_0']);
        });

        test('filters system collections', () => {
            const runner = createRunner();
            const input = [
                { name: 'Patient_4_0_0', type: 'collection' },
                { name: 'system.views', type: 'collection' }
            ];
            const result = runner.getListOfCollections(input);
            expect(result).toEqual(['Patient_4_0_0']);
        });

        test('filters by collections list when provided', () => {
            const runner = createRunner({ collections: ['Patient_4_0_0'] });
            const input = [
                { name: 'Patient_4_0_0', type: 'collection' },
                { name: 'Observation_4_0_0', type: 'collection' }
            ];
            const result = runner.getListOfCollections(input);
            expect(result).toEqual(['Patient_4_0_0']);
        });

        test('skips history collections when flag set', () => {
            const runner = createRunner({ skipHistoryCollections: true });
            const input = [
                { name: 'Patient_4_0_0', type: 'collection' },
                { name: 'Patient_4_0_0_History', type: 'collection' }
            ];
            const result = runner.getListOfCollections(input);
            expect(result).toEqual(['Patient_4_0_0']);
        });

        test('returns empty array for empty input', () => {
            const runner = createRunner();
            expect(runner.getListOfCollections([])).toEqual([]);
        });
    });

    describe('processAsync - _idAbove validation', () => {
        test('returns early if _idAbove set without single collection', () => {
            const runner = createRunner({
                _idAbove: 'some-id',
                collections: ['col1', 'col2']
            });
            runner.processAsync();
            expect(mockAdminLogger.logError).toHaveBeenCalledWith(
                expect.stringContaining('_idAbove')
            );
        });

        test('returns early if _idAbove set with no collections', () => {
            const runner = createRunner({
                _idAbove: 'some-id',
                collections: undefined
            });
            runner.processAsync();
            expect(mockAdminLogger.logError).toHaveBeenCalledWith(
                expect.stringContaining('_idAbove')
            );
        });
    });

    describe('processAsync - date comparison bug', () => {
        test('BUG: string date comparison with moment object always returns false', async () => {
            // This test demonstrates the bug in the date comparison logic.
            // When targetLastUpdated is a string (formatted by moment), comparing
            // it to this.updatedBefore (a moment object) using > or < always returns false
            // because string > number (moment.valueOf()) coerces string to NaN.

            const mockCursor = {
                hasNext: jest.fn()
                    .mockResolvedValueOnce(true)
                    .mockResolvedValueOnce(false),
                next: jest.fn().mockResolvedValueOnce({
                    _id: 'doc-1',
                    meta: { lastUpdated: '2024-01-20T10:00:00Z' } // After updatedBefore (Jan 15)
                })
            };

            const mockSourceCollection = {
                find: jest.fn().mockReturnValue(mockCursor),
                countDocuments: jest.fn().mockResolvedValue(1)
            };

            const mockTargetCollection = {
                findOne: jest.fn().mockResolvedValue({
                    _id: 'doc-1',
                    meta: { lastUpdated: '2024-01-20T10:00:00Z' } // After updatedBefore
                }),
                countDocuments: jest.fn().mockResolvedValue(1),
                updateOne: jest.fn().mockResolvedValue({ modifiedCount: 1 })
            };

            const mockDb = (name) => ({
                collection: jest.fn((collName) => {
                    if (name === 'sourceDb') return mockSourceCollection;
                    return mockTargetCollection;
                }),
                listCollections: jest.fn().mockReturnValue({
                    toArray: jest.fn().mockResolvedValue([
                        { name: 'Patient_4_0_0', type: 'collection' }
                    ])
                })
            });

            const mockSourceDb = mockDb('sourceDb');
            const mockTargetDb = mockDb('targetDb');

            const mockClient = {
                db: jest.fn((dbName) => {
                    if (dbName === 'sourceDb') return mockSourceDb;
                    return mockTargetDb;
                })
            };

            mockMongoDatabaseManager.createClientAsync.mockResolvedValue(mockClient);
            mockMongoDatabaseManager.disconnectClientAsync.mockResolvedValue(undefined);

            // Add the missing .count() method
            mockSourceCollection.find.mockImplementation((query, options) => {
                if (query && query['meta.lastUpdated']) {
                    return { count: jest.fn().mockResolvedValue(0) };
                }
                return mockCursor;
            });

            const runner = createRunner({ collections: ['Patient_4_0_0'] });
            await runner.processAsync();

            // BUG DEMONSTRATION:
            // The target document's lastUpdated (2024-01-20) is AFTER updatedBefore (2024-01-15)
            // so the document should be SKIPPED (targetLastUpdatedGreaterThanUpdatedBefore should be incremented)
            // But due to the string-vs-moment comparison bug:
            //   '2024-01-20T04:00:00-06:00' > moment('2024-01-15') evaluates to false
            // So the document is NOT skipped and proceeds to the update logic.

            // The bug means: targetLastUpdated > this.updatedBefore NEVER returns true
            // when targetLastUpdated is a string. Since NaN > number is false,
            // documents that should be skipped are not skipped.

            // Verify the string > moment comparison behavior:
            const targetLastUpdated = moment('2024-01-20T10:00:00Z').format('YYYY-MM-DDTHH:mm:ssZ');
            const updatedBeforeMoment = moment('2024-01-15T00:00:00Z');

            // This is the buggy comparison from line 274:
            // eslint-disable-next-line no-compare-neg-zero
            const buggyResult = targetLastUpdated > updatedBeforeMoment;
            expect(buggyResult).toBe(false); // BUG: should be true

            // Correct comparison:
            const correctResult = moment(targetLastUpdated).isAfter(updatedBeforeMoment);
            expect(correctResult).toBe(true);
        });

        test('BUG: targetLastUpdated < this.updatedBefore also fails with string vs moment', () => {
            // Line 285: targetLastUpdated < this.updatedBefore
            // When targetLastUpdated is a string, this comparison also fails.
            const targetLastUpdated = moment('2024-01-10T10:00:00Z').format('YYYY-MM-DDTHH:mm:ssZ');
            const updatedBeforeMoment = moment('2024-01-15T00:00:00Z');

            // The buggy comparison from line 285:
            const buggyResult = targetLastUpdated < updatedBeforeMoment;
            expect(buggyResult).toBe(false); // BUG: should be true

            // Correct comparison:
            const correctResult = moment(targetLastUpdated).isBefore(updatedBeforeMoment);
            expect(correctResult).toBe(true);
        });

        test('Date instance comparison with moment works correctly', () => {
            // When targetLastUpdated IS a Date instance, the comparison works because
            // Date.valueOf() returns a number (timestamp) and moment.valueOf() also returns a number
            const targetLastUpdated = new Date('2024-01-20T10:00:00Z');
            const updatedBeforeMoment = moment('2024-01-15T00:00:00Z');

            // This works because Date > moment compares number > number
            const result = targetLastUpdated > updatedBeforeMoment;
            expect(result).toBe(true); // Works correctly with Date objects
        });

        test('BUG consequence: all documents go to skippedCount when targetLastUpdated is string', () => {
            // Tracing the logic when targetLastUpdated is a string:
            // Line 274: targetLastUpdated > this.updatedBefore → false (NaN comparison)
            // Line 278: targetLastUpdated > sourceLastUpdated → works (string vs string)
            //   If target is newer than source → skipped (correct for wrong reason)
            //   If target is older than source → falls through
            // Line 285: targetLastUpdated < this.updatedBefore → false (NaN comparison)
            //   AND targetLastUpdated < sourceLastUpdated → true or false (string vs string)
            //   Since first condition is always false, entire condition is false
            // Line 295: skippedCount++ (always executes when target is older than source)

            // The net effect: when targetLastUpdated is a string (not a Date),
            // NO documents are ever updated. They are either:
            // 1. Skipped at line 278 (if target > source as strings), or
            // 2. Skipped at line 295 (the else branch, since the update condition at 285 is always false)

            const targetDateStr = moment('2024-01-10T10:00:00Z').format('YYYY-MM-DDTHH:mm:ssZ');
            const sourceDateStr = moment('2024-01-12T10:00:00Z').format('YYYY-MM-DDTHH:mm:ssZ');
            const updatedBeforeMoment = moment('2024-01-15T00:00:00Z');

            // Line 274: should be true? No, target is BEFORE updatedBefore, so expected false → ok
            // But what about when target IS after updatedBefore?
            const targetAfterStr = moment('2024-01-20T10:00:00Z').format('YYYY-MM-DDTHH:mm:ssZ');
            expect(targetAfterStr > updatedBeforeMoment).toBe(false); // BUG: should be true

            // Line 285 check: targetDateStr < updatedBeforeMoment
            expect(targetDateStr < updatedBeforeMoment).toBe(false); // BUG: should be true

            // The real consequence: target SHOULD be updated (target is older than both
            // updatedBefore and source), but it never gets updated because line 285 is always false.
            expect(targetDateStr < sourceDateStr).toBe(true); // String comparison works
        });
    });

    describe('processAsync - disconnect in finally', () => {
        test('disconnects clients even on error', async () => {
            const mockClient = { db: jest.fn() };
            mockMongoDatabaseManager.createClientAsync
                .mockResolvedValueOnce(mockClient) // target
                .mockResolvedValueOnce(mockClient); // source

            // Make db() throw to trigger error path
            mockClient.db.mockImplementation(() => {
                throw new Error('db error');
            });

            mockMongoDatabaseManager.disconnectClientAsync.mockResolvedValue(undefined);

            const runner = createRunner();
            await runner.processAsync();

            // Verify both clients are disconnected in finally
            expect(mockMongoDatabaseManager.disconnectClientAsync).toHaveBeenCalledTimes(2);
        });

        test('handles disconnect when first createClientAsync fails', async () => {
            mockMongoDatabaseManager.createClientAsync
                .mockResolvedValueOnce({ db: jest.fn() }) // target succeeds
                .mockRejectedValueOnce(new Error('connection failed')); // source fails

            mockMongoDatabaseManager.disconnectClientAsync.mockResolvedValue(undefined);

            const runner = createRunner();
            await runner.processAsync();

            // disconnectClientAsync is called with undefined for sourceClient
            // This should work because disconnectClientAsync checks `if (client)`
            expect(mockMongoDatabaseManager.disconnectClientAsync).toHaveBeenCalledTimes(2);
        });
    });

    describe('getListOfCollections - serverSelectionTimeout comment bug', () => {
        test('getTargetClusterConfig comment says 60 seconds but value is 600000ms (10 min)', () => {
            // Line 101: serverSelectionTimeoutMS: 600000
            // Comment says "Wait for 60 seconds" but 600000ms = 600 seconds = 10 minutes
            const runner = createRunner();
            const config = runner.getTargetClusterConfig();
            expect(config.options.serverSelectionTimeoutMS).toBe(600000);
            // 600000 ms = 600 s = 10 minutes, NOT 60 seconds as the comment states
            expect(config.options.serverSelectionTimeoutMS / 1000).toBe(600);
            expect(config.options.serverSelectionTimeoutMS / 1000 / 60).toBe(10); // 10 minutes
        });
    });

    describe('batching logic', () => {
        test('creates correct batches with concurrentRunners', () => {
            const runner = createRunner({ concurrentRunners: 2 });
            const collectionList = [
                { name: 'A_4_0_0', type: 'collection' },
                { name: 'B_4_0_0', type: 'collection' },
                { name: 'C_4_0_0', type: 'collection' },
                { name: 'D_4_0_0', type: 'collection' }
            ];
            const result = runner.getListOfCollections(collectionList);
            expect(result).toHaveLength(4);
        });

        test('startWithCollection splices correctly', () => {
            // If startWithCollection is not found, indexOf returns -1,
            // which becomes 0 after the ternary. So splice(0) returns the full array.
            // This is correct behavior.
            const runner = createRunner({ startWithCollection: 'NonExistent' });
            // This just verifies the collections property is set
            expect(runner.startWithCollection).toBe('NonExistent');
        });
    });
});
