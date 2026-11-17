const { describe, test, expect, beforeEach, afterEach } = require('@jest/globals');
const { FastDatabaseBulkInserter } = require('../../../../../dataLayer/fastDatabaseBulkInserter');
const { ConfigManager } = require('../../../../../utils/configManager');
const { WriteStep } = require('../../../../../operations/writePipeline/steps/writeStep');
const { WriteItem, WRITE_ITEM_STATUS } = require('../../../../../operations/writePipeline/writeItem');
const { WRITE_FAILURE_STAGE } = require('../../../../../operations/writePipeline/writeFailure');
const { WriteContext } = require('../../../../../operations/writePipeline/writeContext');

/**
 * Builds an active Patient item with a synthetic id and a candidate document, as an update of a
 * stored version 1 or as an insert.
 */
const buildItem = ({ index, writeMode }) => {
    const item = new WriteItem({
        index,
        incoming: { resourceType: 'Patient', id: `patient-${index}` }
    });
    item.writeMode = writeMode;
    item.candidate = { resourceType: 'Patient', id: `patient-${index}`, _uuid: `uuid-${index}` };
    item.stored = writeMode === 'update' ? { meta: { versionId: '1' } } : null;
    return item;
};

/**
 * Builds a bulk inserter whose `mergeOneAsync` and `insertOneAsync` record in `events` the start
 * and the end of each call, with an await and no I/O in between, and throw for the ids in
 * `failingIds` instead of ending.
 */
const buildDatabaseBulkInserter = ({ events, failingIds = [] }) => {
    const databaseBulkInserter = Object.create(FastDatabaseBulkInserter.prototype);
    const record = (name) => async ({ doc }) => {
        events.push(`start-${doc.id}`);
        await Promise.resolve();
        if (failingIds.includes(doc.id)) {
            throw new Error(`queueing ${doc.id} failed`);
        }
        events.push(`${name}-${doc.id}`);
    };
    databaseBulkInserter.mergeOneAsync = record('merge');
    databaseBulkInserter.insertOneAsync = record('insert');
    return databaseBulkInserter;
};

const context = new WriteContext({
    requestInfo: { requestId: 'request-1' },
    base_version: '4_0_0',
    parsedArgs: {},
    smartMerge: true,
    operationName: 'merge'
});

describe('WriteStep', () => {
    const savedChunkSize = process.env.MERGE_PARALLEL_CHUNK_SIZE;

    beforeEach(() => {
        process.env.MERGE_PARALLEL_CHUNK_SIZE = '2';
    });

    afterEach(() => {
        if (savedChunkSize === undefined) {
            delete process.env.MERGE_PARALLEL_CHUNK_SIZE;
        } else {
            process.env.MERGE_PARALLEL_CHUNK_SIZE = savedChunkSize;
        }
    });

    test('queues the items one at a time in request order and yields to the event loop after every mergeParallelChunkSize items', async () => {
        const events = [];
        const step = new WriteStep({
            databaseBulkInserter: buildDatabaseBulkInserter({ events }),
            configManager: new ConfigManager()
        });
        const items = [
            buildItem({ index: 0, writeMode: 'update' }),
            buildItem({ index: 1, writeMode: 'insert' }),
            buildItem({ index: 2, writeMode: 'update' }),
            buildItem({ index: 3, writeMode: 'insert' }),
            buildItem({ index: 4, writeMode: 'insert' })
        ];
        let running = true;
        const tick = () => {
            if (running) {
                events.push('tick');
                setImmediate(tick);
            }
        };
        setImmediate(tick);

        await step.runAsync({ items, context });
        running = false;

        expect(events).toStrictEqual([
            'start-patient-0', 'merge-patient-0', 'start-patient-1', 'insert-patient-1', 'tick',
            'start-patient-2', 'merge-patient-2', 'start-patient-3', 'insert-patient-3', 'tick',
            'start-patient-4', 'insert-patient-4'
        ]);
        expect(items.map((item) => item.status)).toStrictEqual(
            Array(5).fill(WRITE_ITEM_STATUS.QUEUED)
        );
    });

    test('fails only the item whose queueing throws, at the WRITE stage, and queues the rest', async () => {
        const events = [];
        const step = new WriteStep({
            databaseBulkInserter: buildDatabaseBulkInserter({ events, failingIds: ['patient-1'] }),
            configManager: new ConfigManager()
        });
        const items = [
            buildItem({ index: 0, writeMode: 'insert' }),
            buildItem({ index: 1, writeMode: 'update' }),
            buildItem({ index: 2, writeMode: 'insert' })
        ];

        await step.runAsync({ items, context });

        expect(events).toStrictEqual([
            'start-patient-0', 'insert-patient-0',
            'start-patient-1',
            'start-patient-2', 'insert-patient-2'
        ]);
        expect(items.map((item) => item.status)).toStrictEqual([
            WRITE_ITEM_STATUS.QUEUED,
            WRITE_ITEM_STATUS.FAILED,
            WRITE_ITEM_STATUS.QUEUED
        ]);
        expect(items[1].failure.stage).toBe(WRITE_FAILURE_STAGE.WRITE);
    });

    /**
     * Builds a bulk inserter whose `mergeOneAsync`, `replaceOneAsync` and `insertOneAsync` record
     * the arguments of each call in `calls`.
     */
    const buildRecordingInserter = (calls) => {
        const databaseBulkInserter = Object.create(FastDatabaseBulkInserter.prototype);
        databaseBulkInserter.mergeOneAsync = async (args) => {
            calls.push({ method: 'mergeOneAsync', args });
        };
        databaseBulkInserter.replaceOneAsync = async (args) => {
            calls.push({ method: 'replaceOneAsync', args });
        };
        databaseBulkInserter.insertOneAsync = async (args) => {
            calls.push({ method: 'insertOneAsync', args });
        };
        return databaseBulkInserter;
    };

    /**
     * Builds a PUT context: no smart merge, with the given request headers.
     */
    const buildPutContext = (headers) => new WriteContext({
        requestInfo: { requestId: 'request-1', headers },
        base_version: '4_0_0',
        parsedArgs: {},
        smartMerge: false,
        operationName: 'update'
    });

    /**
     * Builds an update item whose stored doc is version 2 and whose candidate has the given version.
     */
    const buildUpdateItem = ({ candidateVersionId }) => {
        const item = buildItem({ index: 0, writeMode: 'update' });
        item.stored = { meta: { versionId: '2' } };
        item.candidate.meta = { versionId: candidateVersionId };
        item.contextData = { resourceType: 'Patient' };
        return item;
    };

    test('the default queues an update with the stored versionId and the context smartMerge, and an insert with its context data only', async () => {
        const calls = [];
        const step = new WriteStep({
            databaseBulkInserter: buildRecordingInserter(calls),
            configManager: new ConfigManager()
        });
        const update = buildItem({ index: 0, writeMode: 'update' });
        const insert = buildItem({ index: 1, writeMode: 'insert' });

        await step.runAsync({ items: [update, insert], context });

        expect(calls).toStrictEqual([
            {
                method: 'mergeOneAsync',
                args: {
                    requestInfo: context.requestInfo,
                    resourceType: 'Patient',
                    doc: update.candidate,
                    previousVersionId: '1',
                    contextData: null,
                    smartMerge: true
                }
            },
            {
                method: 'insertOneAsync',
                args: {
                    requestInfo: context.requestInfo,
                    resourceType: 'Patient',
                    doc: insert.candidate,
                    contextData: null
                }
            }
        ]);
    });

    test('honorHttpPreconditions queues an update with the stored versionId, smartMerge false and the If-Match writePrecondition', async () => {
        const calls = [];
        const step = new WriteStep({
            databaseBulkInserter: buildRecordingInserter(calls),
            configManager: new ConfigManager(),
            honorHttpPreconditions: true
        });
        const putContext = buildPutContext({ 'if-match': 'W/"2"' });
        const item = buildUpdateItem({ candidateVersionId: '3' });

        await step.runAsync({ items: [item], context: putContext });

        expect(calls).toStrictEqual([{
            method: 'mergeOneAsync',
            args: {
                requestInfo: putContext.requestInfo,
                resourceType: 'Patient',
                doc: item.candidate,
                previousVersionId: '2',
                contextData: { resourceType: 'Patient' },
                smartMerge: false,
                writePrecondition: { ifMatchVersionIds: ['2'] }
            }
        }]);
        expect(item.status).toBe(WRITE_ITEM_STATUS.QUEUED);
    });

    test.each([
        {
            name: 'forcedGroupWriteQueuesReplaceWithIfMatchVersionIds',
            headers: { 'if-match': 'W/"2"' },
            ifMatchVersionIds: ['2']
        },
        {
            name: 'forcedGroupWriteQueuesReplaceWithoutIfMatch',
            headers: {},
            ifMatchVersionIds: []
        }
    ])('$name', async ({ headers, ifMatchVersionIds }) => {
        const calls = [];
        const step = new WriteStep({
            databaseBulkInserter: buildRecordingInserter(calls),
            configManager: new ConfigManager(),
            honorHttpPreconditions: true
        });
        const putContext = buildPutContext(headers);
        const item = buildUpdateItem({ candidateVersionId: '2' });

        await step.runAsync({ items: [item], context: putContext });

        expect(calls).toStrictEqual([{
            method: 'replaceOneAsync',
            args: {
                requestInfo: putContext.requestInfo,
                resourceType: 'Patient',
                doc: item.candidate,
                uuid: 'uuid-0',
                contextData: { resourceType: 'Patient' },
                ifMatchVersionIds
            }
        }]);
        expect(item.status).toBe(WRITE_ITEM_STATUS.QUEUED);
    });

    test.each([
        {
            name: 'honorHttpPreconditions queues an update without the version filter when concurrency handling is off',
            headers: {},
            previousVersionId: null,
            writePrecondition: null
        },
        {
            name: 'honorHttpPreconditions queues an update without the version filter for If-Match: * when concurrency handling is off',
            headers: { 'if-match': '*' },
            previousVersionId: null,
            writePrecondition: { ifMatchVersionIds: ['*'] }
        },
        {
            name: 'honorHttpPreconditions keeps the version filter for a specific If-Match when concurrency handling is off',
            headers: { 'if-match': 'W/"2"' },
            previousVersionId: '2',
            writePrecondition: { ifMatchVersionIds: ['2'] }
        }
    ])('$name', async ({ headers, previousVersionId, writePrecondition }) => {
        const calls = [];
        const configManager = new ConfigManager();
        Object.defineProperty(configManager, 'handleConcurrency', { get: () => false });
        const step = new WriteStep({
            databaseBulkInserter: buildRecordingInserter(calls),
            configManager,
            honorHttpPreconditions: true
        });
        const putContext = buildPutContext(headers);
        const item = buildUpdateItem({ candidateVersionId: '3' });

        await step.runAsync({ items: [item], context: putContext });

        expect(calls).toStrictEqual([{
            method: 'mergeOneAsync',
            args: {
                requestInfo: putContext.requestInfo,
                resourceType: 'Patient',
                doc: item.candidate,
                previousVersionId,
                contextData: { resourceType: 'Patient' },
                smartMerge: false,
                writePrecondition
            }
        }]);
        expect(item.status).toBe(WRITE_ITEM_STATUS.QUEUED);
    });

    test.each([
        {
            name: 'clickHouseMemberWriteWithoutIfMatchIsWrittenByUuidOnly',
            headers: {},
            contextData: { useExternalStorage: true, groupMembers: [] },
            clickHouseResources: ['Group'],
            previousVersionId: null,
            writePrecondition: null
        },
        {
            name: 'clickHouseMemberWriteWithWildcardIfMatchIsWrittenByUuidOnly',
            headers: { 'if-match': '*' },
            contextData: { useExternalStorage: true, groupMembers: [] },
            clickHouseResources: ['Group'],
            previousVersionId: null,
            writePrecondition: { ifMatchVersionIds: ['*'] }
        },
        {
            name: 'clickHouseMemberWriteWithSpecificIfMatchKeepsTheVersionFilter',
            headers: { 'if-match': 'W/"2"' },
            contextData: { useExternalStorage: true, groupMembers: [] },
            clickHouseResources: ['Group'],
            previousVersionId: '2',
            writePrecondition: { ifMatchVersionIds: ['2'] }
        },
        {
            name: 'externalStorageGroupWithoutMemberKeepsTheVersionFilter',
            headers: {},
            contextData: { useExternalStorage: true, groupMembers: undefined },
            clickHouseResources: ['Group'],
            previousVersionId: '2',
            writePrecondition: null
        },
        {
            name: 'groupMemberWriteWithoutExternalStorageKeepsTheVersionFilter',
            headers: {},
            contextData: { useExternalStorage: false, groupMembers: [] },
            clickHouseResources: ['Group'],
            previousVersionId: '2',
            writePrecondition: null
        },
        {
            name: 'groupMemberWriteWithClickHouseOffForGroupKeepsTheVersionFilter',
            headers: {},
            contextData: { useExternalStorage: true, groupMembers: [] },
            clickHouseResources: [],
            previousVersionId: '2',
            writePrecondition: null
        }
    ])('$name', async ({ headers, contextData, clickHouseResources, previousVersionId, writePrecondition }) => {
        const calls = [];
        const configManager = new ConfigManager();
        Object.defineProperty(configManager, 'handleConcurrency', { get: () => true });
        Object.defineProperty(configManager, 'enableClickHouse', { get: () => true });
        Object.defineProperty(configManager, 'mongoWithClickHouseResources', { get: () => clickHouseResources });
        const step = new WriteStep({
            databaseBulkInserter: buildRecordingInserter(calls),
            configManager,
            honorHttpPreconditions: true
        });
        const putContext = buildPutContext(headers);
        const item = buildUpdateItem({ candidateVersionId: '3' });
        item.candidate.resourceType = 'Group';
        item.contextData = { resourceType: 'Group', ...contextData };

        await step.runAsync({ items: [item], context: putContext });

        expect(calls).toStrictEqual([{
            method: 'mergeOneAsync',
            args: {
                requestInfo: putContext.requestInfo,
                resourceType: 'Group',
                doc: item.candidate,
                previousVersionId,
                contextData: item.contextData,
                smartMerge: false,
                writePrecondition
            }
        }]);
        expect(item.status).toBe(WRITE_ITEM_STATUS.QUEUED);
    });

    test.each([
        {
            name: 'honorHttpPreconditions queues an insert with rejectIfExists for If-None-Match: * and smartMerge false',
            header: '*',
            rejectIfExists: true
        },
        {
            name: 'honorHttpPreconditions queues an insert without rejectIfExists when no If-None-Match is sent, and smartMerge false',
            header: undefined,
            rejectIfExists: false
        }
    ])('$name', async ({ header, rejectIfExists }) => {
        const calls = [];
        const step = new WriteStep({
            databaseBulkInserter: buildRecordingInserter(calls),
            configManager: new ConfigManager(),
            honorHttpPreconditions: true
        });
        const putContext = buildPutContext(header === undefined ? {} : { 'if-none-match': header });
        const item = buildItem({ index: 0, writeMode: 'insert' });

        await step.runAsync({ items: [item], context: putContext });

        expect(calls).toStrictEqual([{
            method: 'insertOneAsync',
            args: {
                requestInfo: putContext.requestInfo,
                resourceType: 'Patient',
                doc: item.candidate,
                contextData: null,
                rejectIfExists,
                smartMerge: false
            }
        }]);
    });
});
