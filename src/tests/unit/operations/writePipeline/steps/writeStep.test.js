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
});
