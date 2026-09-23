'use strict';

const { describe, test, expect, beforeEach, afterEach, jest: jestGlobal } = require('@jest/globals');

const fs = require('fs');
const { Writable } = require('stream');

const { GetMultipleOwnerDataCsvRunner } = require('../../../../admin/runners/getMultipleOwnerDataCsvRunner');
const { AdminLogger } = require('../../../../admin/adminLogger');
const { MongoDatabaseManager } = require('../../../../utils/mongoDatabaseManager');
const { SecurityTagSystem } = require('../../../../utils/securityTagSystem');

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
    sink.close = jestGlobal.fn(() => { setImmediate(() => sink.emit('close')); });
    return sink;
}

function makeAggregateCursor (results) {
    let i = 0;
    return {
        hasNext: jestGlobal.fn(async () => i < results.length),
        next: jestGlobal.fn(async () => results[i++])
    };
}

describe('GetMultipleOwnerDataCsvRunner', () => {
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
        mockMongoDatabaseManager.getClientConfigAsync = jestGlobal.fn().mockResolvedValue({
            connection: 'mongodb://localhost:27017', db_name: 'test_db', options: {}
        });

        sink = makeSink();
        createWriteStreamSpy = jestGlobal.spyOn(fs, 'createWriteStream').mockReturnValue(sink);

        mockSession = { endSession: jestGlobal.fn().mockResolvedValue(undefined) };
        mockClient = { close: jestGlobal.fn().mockResolvedValue(undefined) };

        runner = new GetMultipleOwnerDataCsvRunner({
            batchSize: 100, adminLogger: mockAdminLogger, mongoDatabaseManager: mockMongoDatabaseManager
        });
    });

    afterEach(() => {
        createWriteStreamSpy.mockRestore();
    });

    function makeCollection ({ namespace, duplicateTotal, multipleTotal, countDocuments }) {
        const duplicateResults = duplicateTotal === undefined ? [] : [{ total: duplicateTotal }];
        const multipleResults = multipleTotal === undefined ? [] : [{ total: multipleTotal }];
        return {
            namespace,
            aggregate: jestGlobal.fn()
                .mockReturnValueOnce(makeAggregateCursor(duplicateResults))
                .mockReturnValueOnce(makeAggregateCursor(multipleResults)),
            countDocuments: jestGlobal.fn().mockResolvedValue(countDocuments)
        };
    }

    function wireDb (collections) {
        runner.createSingeConnectionAsync = jestGlobal.fn().mockResolvedValue({
            db: { collections: jestGlobal.fn().mockResolvedValue(collections) },
            client: mockClient,
            session: mockSession
        });
    }

    // =====================================================
    // initializeWriteStream
    // =====================================================
    describe('initializeWriteStream', () => {
        test('creates the CSV file with the expected header row', () => {
            runner.initializeWriteStream();

            expect(createWriteStreamSpy).toHaveBeenCalledWith('collectionwise_multiple_owner_count.csv');
            expect(sink.__text()).toContain('Documents with Duplicate Owner Tags');
        });
    });

    // =====================================================
    // handleWriteStreamClose
    // =====================================================
    describe('handleWriteStreamClose', () => {
        test('resolves once the underlying stream emits close', async () => {
            runner.initializeWriteStream();
            await runner.handleWriteStreamClose();
            expect(sink.close).toHaveBeenCalledTimes(1);
        });
    });

    // =====================================================
    // getOwnerCountForCollectionsAsync
    // =====================================================
    describe('getOwnerCountForCollectionsAsync', () => {
        beforeEach(() => {
            runner.initializeWriteStream();
        });

        test('writes duplicate/multiple/total counts for a resource collection', async () => {
            wireDb([makeCollection({
                namespace: 'test_db.Patient_4_0_0', duplicateTotal: 2, multipleTotal: 5, countDocuments: 100
            })]);

            await runner.getOwnerCountForCollectionsAsync();

            expect(sink.__text()).toContain('Patient_4_0_0| 2| 5| 100|');
        });

        test('defaults duplicate/multiple counts to 0 when the aggregation finds no matches', async () => {
            wireDb([makeCollection({ namespace: 'test_db.Patient_4_0_0', countDocuments: 10 })]);

            await runner.getOwnerCountForCollectionsAsync();

            expect(sink.__text()).toContain('Patient_4_0_0| 0| 0| 10|');
        });

        test('ignores collections without the _4_0_0 resource suffix', async () => {
            wireDb([makeCollection({ namespace: 'test_db.system.indexes', countDocuments: 1 })]);

            await runner.getOwnerCountForCollectionsAsync();

            expect(sink.__text()).not.toContain('system.indexes');
        });

        test('ignores _History collections', async () => {
            wireDb([makeCollection({ namespace: 'test_db.Patient_4_0_0_History', countDocuments: 1 })]);

            await runner.getOwnerCountForCollectionsAsync();

            expect(sink.__text()).not.toContain('Patient_4_0_0_History|');
        });

        test('processes multiple qualifying collections, one row each', async () => {
            wireDb([
                makeCollection({ namespace: 'test_db.Patient_4_0_0', duplicateTotal: 1, multipleTotal: 1, countDocuments: 10 }),
                makeCollection({ namespace: 'test_db.Practitioner_4_0_0', duplicateTotal: 3, multipleTotal: 4, countDocuments: 20 })
            ]);

            await runner.getOwnerCountForCollectionsAsync();

            expect(sink.__text()).toContain('Patient_4_0_0| 1| 1| 10|');
            expect(sink.__text()).toContain('Practitioner_4_0_0| 3| 4| 20|');
        });

        test('the duplicate-owner-tag pipeline matches only meta.security entries tagged as owner', async () => {
            const collection = makeCollection({ namespace: 'test_db.Patient_4_0_0', countDocuments: 1 });
            wireDb([collection]);

            await runner.getOwnerCountForCollectionsAsync();

            const duplicatePipeline = collection.aggregate.mock.calls[0][0];
            expect(duplicatePipeline).toContainEqual({ $match: { 'meta.security.system': SecurityTagSystem.owner } });
        });

        test('always ends the session and closes the client on success', async () => {
            wireDb([]);

            await runner.getOwnerCountForCollectionsAsync();

            expect(mockSession.endSession).toHaveBeenCalledTimes(1);
            expect(mockClient.close).toHaveBeenCalledTimes(1);
        });

        test('rethrows a RethrownError and still cleans up the connection when the aggregate fails', async () => {
            const throwingCollection = {
                namespace: 'test_db.Patient_4_0_0',
                aggregate: jestGlobal.fn(() => { throw new Error('mongo down'); })
            };
            wireDb([throwingCollection]);

            await expect(runner.getOwnerCountForCollectionsAsync()).rejects.toThrow('mongo down');

            expect(mockSession.endSession).toHaveBeenCalledTimes(1);
            expect(mockClient.close).toHaveBeenCalledTimes(1);
        });
    });

    // =====================================================
    // processAsync
    // =====================================================
    describe('processAsync', () => {
        test('runs the full pipeline end to end', async () => {
            wireDb([makeCollection({ namespace: 'test_db.Patient_4_0_0', duplicateTotal: 1, multipleTotal: 1, countDocuments: 5 })]);

            await runner.processAsync();

            expect(createWriteStreamSpy).toHaveBeenCalled();
        });

        test('a failure deep in the pipeline is logged and does not propagate out of processAsync', async () => {
            runner.getOwnerCountForCollectionsAsync = jestGlobal.fn().mockRejectedValue(new Error('boom'));

            await expect(runner.processAsync()).resolves.toBeUndefined();

            expect(mockAdminLogger.logError).toHaveBeenCalledWith(expect.stringContaining('boom'), expect.any(Object));
        });
    });
});
