'use strict';

const { describe, test, expect, beforeEach, afterEach, jest: jestGlobal } = require('@jest/globals');

const fs = require('fs');
const { Writable } = require('stream');

const {
    GetIdSourceIdMismatchCountRunner
} = require('../../../../admin/runners/getIdSourceIdMismatchCountRunner');
const { AdminLogger } = require('../../../../admin/adminLogger');
const { MongoDatabaseManager } = require('../../../../utils/mongoDatabaseManager');

function createMockInstance (ClassType) {
    return Object.create(ClassType.prototype);
}

function makeSink () {
    const chunks = [];
    const sink = new Writable({
        write (chunk, _encoding, cb) {
            chunks.push(chunk.toString());
            cb();
        }
    });
    sink.__text = () => chunks.join('');
    // Plain Writable streams don't implement close() (only fs.WriteStream does); the runner calls
    // writeStream.close() THEN registers a 'close' listener, so (matching real fs.WriteStream
    // semantics) the event must fire on a later tick, not synchronously inside close() itself.
    sink.close = jestGlobal.fn(() => { setImmediate(() => sink.emit('close')); });
    return sink;
}

/**
 * A mongo-ish aggregate cursor yielding a fixed set of facet result documents.
 * @param {Object[]} results
 */
function makeAggregateCursor (results) {
    let i = 0;
    return {
        hasNext: jestGlobal.fn(async () => i < results.length),
        next: jestGlobal.fn(async () => results[i++])
    };
}

function makeCollection ({ namespace, aggregateResults = [], countResult }) {
    return {
        namespace,
        aggregate: jestGlobal.fn().mockReturnValue(
            countResult !== undefined
                ? makeAggregateCursor([countResult])
                : makeAggregateCursor(aggregateResults)
        )
    };
}

describe('GetIdSourceIdMismatchCountRunner', () => {
    let runner;
    let mockAdminLogger;
    let mockMongoDatabaseManager;
    let sink;
    let createWriteStreamSpy;
    let mockSession;
    let mockClient;

    beforeEach(() => {
        mockAdminLogger = createMockInstance(AdminLogger);
        mockAdminLogger.logInfo = jestGlobal.fn();
        mockAdminLogger.logError = jestGlobal.fn();

        mockMongoDatabaseManager = createMockInstance(MongoDatabaseManager);

        sink = makeSink();
        createWriteStreamSpy = jestGlobal.spyOn(fs, 'createWriteStream').mockReturnValue(sink);

        mockSession = { endSession: jestGlobal.fn().mockResolvedValue(undefined) };
        mockClient = { close: jestGlobal.fn().mockResolvedValue(undefined) };

        runner = new GetIdSourceIdMismatchCountRunner({
            batchSize: 100,
            adminLogger: mockAdminLogger,
            mongoDatabaseManager: mockMongoDatabaseManager
        });
        runner.mongoDatabaseManager.getClientConfigAsync = jestGlobal.fn().mockResolvedValue({
            connection: 'mongodb://localhost:27017', db_name: 'test_db', options: {}
        });
    });

    afterEach(() => {
        createWriteStreamSpy.mockRestore();
    });

    function wireDb (collections) {
        runner.createSingeConnectionAsync = jestGlobal.fn().mockResolvedValue({
            db: { collections: jestGlobal.fn().mockResolvedValue(collections) },
            client: mockClient,
            session: mockSession
        });
    }

    // =====================================================
    // initializeWriteStream / handleWriteStreamClose
    // =====================================================
    describe('initializeWriteStream', () => {
        test('creates the CSV file with the expected header row', () => {
            runner.initializeWriteStream();

            expect(createWriteStreamSpy).toHaveBeenCalledWith('collectionwise_id_sourceid_mismatch_count.csv');
            expect(sink.__text()).toContain('Resource| Count | Uuid with min lastUpdated');
        });
    });

    describe('handleWriteStreamClose', () => {
        test('resolves once the underlying stream emits close', async () => {
            runner.initializeWriteStream();

            await runner.handleWriteStreamClose();

            expect(sink.close).toHaveBeenCalledTimes(1);
        });
    });

    // =====================================================
    // getIdSourceIdMismatchCountAsync
    // =====================================================
    describe('getIdSourceIdMismatchCountAsync', () => {
        beforeEach(() => {
            runner.initializeWriteStream();
        });

        test('writes a row for a collection with mismatched id/_sourceId documents', async () => {
            wireDb([makeCollection({
                namespace: 'test_db.Patient_4_0_0',
                countResult: {
                    totalCount: 3,
                    minUuid: 'u-min', minLastUpdated: '2024-01-01T00:00:00.000Z',
                    maxUuid: 'u-max', maxLastUpdated: '2024-06-01T00:00:00.000Z'
                }
            })]);

            await runner.getIdSourceIdMismatchCountAsync();

            expect(sink.__text()).toContain('Patient_4_0_0| 3| u-min| 2024-01-01T00:00:00.000Z| u-max| 2024-06-01T00:00:00.000Z|');
        });

        test('skips a collection with zero mismatches (no row written)', async () => {
            wireDb([makeCollection({ namespace: 'test_db.Patient_4_0_0', countResult: { totalCount: 0 } })]);

            await runner.getIdSourceIdMismatchCountAsync();

            expect(sink.__text().split('\n').filter((l) => l.startsWith('Patient_4_0_0'))).toHaveLength(0);
        });

        test('ignores collections that are not resource collections (no _4_0_0 suffix)', async () => {
            wireDb([makeCollection({ namespace: 'test_db.system.indexes', countResult: { totalCount: 5 } })]);

            await runner.getIdSourceIdMismatchCountAsync();

            expect(mockAdminLogger.logInfo).not.toHaveBeenCalledWith(expect.stringContaining('Processing'));
        });

        test('ignores _History collections', async () => {
            wireDb([makeCollection({ namespace: 'test_db.Patient_4_0_0_History', countResult: { totalCount: 5 } })]);

            await runner.getIdSourceIdMismatchCountAsync();

            expect(sink.__text()).not.toContain('Patient_4_0_0_History');
        });

        test('processes multiple qualifying collections and writes one row each', async () => {
            wireDb([
                makeCollection({
                    namespace: 'test_db.Patient_4_0_0',
                    countResult: { totalCount: 1, minUuid: 'a', minLastUpdated: '2024-01-01', maxUuid: 'a', maxLastUpdated: '2024-01-01' }
                }),
                makeCollection({
                    namespace: 'test_db.Practitioner_4_0_0',
                    countResult: { totalCount: 2, minUuid: 'b', minLastUpdated: '2024-02-01', maxUuid: 'c', maxLastUpdated: '2024-03-01' }
                })
            ]);

            await runner.getIdSourceIdMismatchCountAsync();

            expect(sink.__text()).toContain('Patient_4_0_0|');
            expect(sink.__text()).toContain('Practitioner_4_0_0|');
        });

        test('falls back to "-" and logs an error when a lastUpdated value cannot be formatted', async () => {
            wireDb([makeCollection({
                namespace: 'test_db.Patient_4_0_0',
                countResult: {
                    totalCount: 1,
                    minUuid: 'u-min', minLastUpdated: undefined,
                    maxUuid: 'u-max', maxLastUpdated: '2024-06-01T00:00:00.000Z'
                }
            })]);

            await runner.getIdSourceIdMismatchCountAsync();

            expect(sink.__text()).toContain('Patient_4_0_0| 1| u-min| -|');
            expect(mockAdminLogger.logError).toHaveBeenCalledWith(expect.stringContaining('Invalid date format'));
        });

        test('always ends the session and closes the client on success', async () => {
            wireDb([]);

            await runner.getIdSourceIdMismatchCountAsync();

            expect(mockSession.endSession).toHaveBeenCalledTimes(1);
            expect(mockClient.close).toHaveBeenCalledTimes(1);
        });

        test('rethrows a RethrownError and still cleans up the connection when the aggregate fails', async () => {
            const throwingCollection = {
                namespace: 'test_db.Patient_4_0_0',
                aggregate: jestGlobal.fn(() => { throw new Error('mongo down'); })
            };
            wireDb([throwingCollection]);

            await expect(runner.getIdSourceIdMismatchCountAsync()).rejects.toThrow('mongo down');

            expect(mockSession.endSession).toHaveBeenCalledTimes(1);
            expect(mockClient.close).toHaveBeenCalledTimes(1);
        });
    });

    // =====================================================
    // processAsync
    // =====================================================
    describe('processAsync', () => {
        test('runs the full pipeline and closes the write stream on success', async () => {
            wireDb([]);

            await runner.processAsync();

            expect(createWriteStreamSpy).toHaveBeenCalled();
        });

        test('a failure deep in the pipeline is logged and does not propagate out of processAsync', async () => {
            runner.getIdSourceIdMismatchCountAsync = jestGlobal.fn().mockRejectedValue(new Error('boom'));
            runner.initializeWriteStream();

            await expect(runner.processAsync()).resolves.toBeUndefined();

            expect(mockAdminLogger.logError).toHaveBeenCalledWith(expect.stringContaining('boom'), expect.any(Object));
        });
    });
});
