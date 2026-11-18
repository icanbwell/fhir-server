const { describe, test, expect } = require('@jest/globals');
const { FastDatabaseBulkInserter } = require('../../../../../../dataLayer/fastDatabaseBulkInserter');
const { ConfigManager } = require('../../../../../../utils/configManager');
const { WriteStep } = require('../../../../../../operations/writePipeline/steps/writeStep');
const { VersionedWriter } = require('../../../../../../operations/writePipeline/steps/write/versionedWriter');
const { WriteItem } = require('../../../../../../operations/writePipeline/writeItem');
const { WriteContext } = require('../../../../../../operations/writePipeline/writeContext');

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

const context = new WriteContext({
    requestInfo: { requestId: 'request-1' },
    base_version: '4_0_0',
    parsedArgs: {},
    smartMerge: true
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

describe('VersionedWriter', () => {
    test('queues an update with the stored versionId and the context smartMerge, and an insert with its context data only', async () => {
        const calls = [];
        const step = new WriteStep({
            writer: new VersionedWriter({ databaseBulkInserter: buildRecordingInserter(calls) }),
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
});
