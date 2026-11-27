const { describe, test, expect } = require('@jest/globals');
const { FastDatabaseBulkInserter } = require('../../../../../../dataLayer/fastDatabaseBulkInserter');
const { ConfigManager } = require('../../../../../../utils/configManager');
const { WriteStep } = require('../../../../../../operations/writePipeline/steps/writeStep');
const { VersionedWriter } = require('../../../../../../operations/writePipeline/steps/write/versionedWriter');
const {
    HttpPreconditionWriter
} = require('../../../../../../operations/writePipeline/steps/write/httpPreconditionWriter');
const { WriteItem, WRITE_ITEM_STATUS } = require('../../../../../../operations/writePipeline/writeItem');
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
    smartMerge: false
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

/**
 * Builds a `WriteStep` whose writer is an `HttpPreconditionWriter` over the bulk inserter.
 */
const buildStep = ({ databaseBulkInserter, configManager = new ConfigManager() }) => new WriteStep({
    writer: new HttpPreconditionWriter({
        databaseBulkInserter,
        configManager,
        versionedWriter: new VersionedWriter({ databaseBulkInserter })
    }),
    configManager
});

describe('HttpPreconditionWriter', () => {
    test('queues an update with the stored versionId, smartMerge false and the If-Match writePrecondition', async () => {
        const calls = [];
        const step = buildStep({ databaseBulkInserter: buildRecordingInserter(calls) });
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
        const step = buildStep({ databaseBulkInserter: buildRecordingInserter(calls) });
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
            name: 'queues an update without the version filter when concurrency handling is off',
            headers: {},
            previousVersionId: null,
            writePrecondition: null
        },
        {
            name: 'queues an update without the version filter for If-Match: * when concurrency handling is off',
            headers: { 'if-match': '*' },
            previousVersionId: null,
            writePrecondition: { ifMatchVersionIds: ['*'] }
        },
        {
            name: 'keeps the version filter for a specific If-Match when concurrency handling is off',
            headers: { 'if-match': 'W/"2"' },
            previousVersionId: '2',
            writePrecondition: { ifMatchVersionIds: ['2'] }
        }
    ])('$name', async ({ headers, previousVersionId, writePrecondition }) => {
        const calls = [];
        const configManager = new ConfigManager();
        Object.defineProperty(configManager, 'handleConcurrency', { get: () => false });
        const step = buildStep({ databaseBulkInserter: buildRecordingInserter(calls), configManager });
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
        const step = buildStep({ databaseBulkInserter: buildRecordingInserter(calls), configManager });
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
            name: 'queues an insert with rejectIfExists for If-None-Match: * and smartMerge false',
            header: '*',
            rejectIfExists: true
        },
        {
            name: 'queues an insert without rejectIfExists when no If-None-Match is sent, and smartMerge false',
            header: undefined,
            rejectIfExists: false
        }
    ])('$name', async ({ header, rejectIfExists }) => {
        const calls = [];
        const step = buildStep({ databaseBulkInserter: buildRecordingInserter(calls) });
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
