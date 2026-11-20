const { describe, beforeAll, afterAll, test, expect, jest } = require('@jest/globals');
const { FastDatabaseBulkInserter } = require('../../../../../../dataLayer/fastDatabaseBulkInserter');
const { DatabaseAttachmentManager } = require('../../../../../../dataLayer/databaseAttachmentManager');
const {
    MongoGroupMemberRepository
} = require('../../../../../../dataLayer/repositories/mongoGroupMemberRepository');
const {
    GroupMemberPatchStrategy
} = require('../../../../../../operations/patch/strategies/groupMemberPatchStrategy');
const { ConfigManager } = require('../../../../../../utils/configManager');
const { RethrownError } = require('../../../../../../utils/rethrownError');
const { buildContextDataForHybridStorage } = require('../../../../../../utils/contextDataBuilder');
const { WriteStep } = require('../../../../../../operations/writePipeline/steps/writeStep');
const { PatchWriter } = require('../../../../../../operations/writePipeline/steps/write/patchWriter');
const { WriteItem, WRITE_ITEM_STATUS } = require('../../../../../../operations/writePipeline/writeItem');
const { WriteContext } = require('../../../../../../operations/writePipeline/writeContext');
const { WRITE_FAILURE_STAGE } = require('../../../../../../operations/writePipeline/writeFailure');
const { GRIDFS: { DELETE } } = require('../../../../../../constants');
const { isUuid } = require('../../../../../../utils/uid.util');
const BaseSerializer = require(
    '../../../../../../fhir/writeSerializers/4_0_0/customSerializers/baseSerializer'
);

const PROMOTION_LIMIT = 2;
const LAST_UPDATED = '2024-01-01T00:00:00.000Z';

/**
 * Builds a fresh list of synthetic security tags, so no test shares tags that the write serializer
 * changes in place.
 * @returns {Object[]}
 */
const buildSecurityTags = () => [
    { system: 'https://www.icanbwell.com/owner', code: 'owner' },
    { system: 'https://www.icanbwell.com/access', code: 'owner' },
    { system: 'https://www.icanbwell.com/sourceAssigningAuthority', code: 'owner' }
];

/**
 * Builds a PATCH context for the synthetic id `resource-0`.
 * @returns {WriteContext}
 */
const buildContext = () => new WriteContext({
    requestInfo: { requestId: 'request-1', headers: {} },
    base_version: '4_0_0',
    parsedArgs: { id: 'resource-0' },
    smartMerge: false
});

/**
 * Builds `count` synthetic Group members.
 * @param {number} count
 * @returns {Object[]}
 */
const members = (count) => Array.from({ length: count }, (_, index) => ({
    entity: { reference: `Patient/member-${index}` }
}));

/**
 * Builds an update item whose stored document is version 1 and whose candidate is version 2, with
 * the given resource type, extra candidate fields, applied patch, member writes and context data.
 * @param {number} index
 * @param {string} resourceType
 * @param {Object} candidateFields
 * @param {Object[]} appliedPatch
 * @param {Object|null} memberWrites
 * @param {Object|null} contextData
 * @returns {WriteItem}
 */
const buildItem = ({
    index = 0,
    resourceType = 'Patient',
    candidateFields = {},
    appliedPatch = [{ op: 'replace', path: '/gender', value: 'female' }],
    memberWrites = null,
    contextData = { resourceType }
} = {}) => {
    const id = `resource-${index}`;
    const item = new WriteItem({ index, incoming: { resourceType, id, _uuid: `uuid-${index}` } });
    item.writeMode = 'update';
    item.stored = { resourceType, id, _uuid: `uuid-${index}`, meta: { versionId: '1' } };
    item.candidate = {
        resourceType,
        id,
        _uuid: `uuid-${index}`,
        _sourceAssigningAuthority: 'owner',
        meta: { versionId: '2', lastUpdated: LAST_UPDATED, security: buildSecurityTags() },
        ...candidateFields
    };
    item.appliedPatch = appliedPatch;
    item.memberWrites = memberWrites;
    item.contextData = contextData;
    return item;
};

/**
 * Builds extended Group member writes with the given count and pending flag.
 * @param {number} memberOperationCount
 * @param {boolean} hasPendingMemberWrites
 * @returns {Object}
 */
const extendedWrites = ({ memberOperationCount = 1, hasPendingMemberWrites = true } = {}) => ({
    type: 'extended',
    memberOperationCount,
    pendingMemberWrites: new Map([['Patient/member-0', { writeType: 'create' }]]),
    hasPendingMemberWrites,
    sourceAssigningAuthority: 'owner'
});

/**
 * Builds external-storage Group member writes with one added member.
 * @param {number} memberOperationCount
 * @returns {Object}
 */
const externalStorageWrites = ({ memberOperationCount = 1 } = {}) => ({
    type: 'externalStorage',
    memberOperationCount,
    events: { eventsToAdd: members(1), eventsToRemove: [] }
});

/**
 * Builds the writer over fakes at the boundaries that record every effect, in order, in `log`:
 * the bulk inserter, the attachment manager, the Group member repository and the member strategy.
 * The real `promoteExistingGroupIfNeeded` runs against them, with extended Groups on and a
 * promotion limit of `PROMOTION_LIMIT`. `strategyError` makes both strategy calls throw it.
 * @param {Error|null} strategyError
 * @returns {{writer: PatchWriter, configManager: ConfigManager, log: string[],
 *     databaseBulkInserter: Object, databaseAttachmentManager: Object,
 *     groupMemberPatchStrategy: Object, mongoGroupMemberRepository: Object}}
 */
const buildWriter = ({ strategyError = null } = {}) => {
    const log = [];
    const configManager = new ConfigManager();
    Object.defineProperty(configManager, 'enableExtendedGroup', { get: () => true });
    Object.defineProperty(configManager, 'groupMemberPromotionLimit', { get: () => PROMOTION_LIMIT });

    const databaseBulkInserter = Object.create(FastDatabaseBulkInserter.prototype);
    databaseBulkInserter.replaceOneAsync = jest.fn(async () => {
        log.push('replaceOne');
    });
    databaseBulkInserter.mergeOneAsync = jest.fn();
    databaseBulkInserter.insertOneAsync = jest.fn();
    databaseBulkInserter.executeAsync = jest.fn();

    const databaseAttachmentManager = Object.create(DatabaseAttachmentManager.prototype);
    databaseAttachmentManager.transformAttachments = jest.fn(async (resource) => {
        log.push('markGridFsInactive');
        return resource;
    });

    const mongoGroupMemberRepository = Object.create(MongoGroupMemberRepository.prototype);
    mongoGroupMemberRepository.removeMembersNotAtVersionAsync = jest.fn(async () => {
        log.push('promotion:removeMembersNotAtVersion');
    });
    mongoGroupMemberRepository.resolveMemberWritesAsync = jest.fn(async () => {
        log.push('promotion:resolveMemberWrites');
        return new Map();
    });
    mongoGroupMemberRepository.applyResolvedMemberWritesAsync = jest.fn(async () => {
        log.push('promotion:applyResolvedMemberWrites');
    });

    const groupMemberPatchStrategy = Object.create(GroupMemberPatchStrategy.prototype);
    groupMemberPatchStrategy.commitPendingMemberWrites = jest.fn(async () => {
        if (strategyError) {
            throw strategyError;
        }
        log.push('commitExtendedMembers');
    });
    groupMemberPatchStrategy.writeClickHouseMemberEventsAsync = jest.fn(async () => {
        if (strategyError) {
            throw strategyError;
        }
        log.push('writeClickHouseEvents');
    });

    const writer = new PatchWriter({
        databaseBulkInserter,
        groupMemberPatchStrategy,
        mongoGroupMemberRepository,
        databaseAttachmentManager,
        configManager
    });
    return {
        writer,
        configManager,
        log,
        databaseBulkInserter,
        databaseAttachmentManager,
        groupMemberPatchStrategy,
        mongoGroupMemberRepository
    };
};

/**
 * Builds a `WriteStep` over the writer.
 * @param {PatchWriter} writer
 * @param {ConfigManager} configManager
 * @returns {WriteStep}
 */
const buildStep = ({ writer, configManager }) => new WriteStep({ writer, configManager });

/**
 * Builds a successful flush result for the item, `updated` as given.
 * @param {WriteItem} item
 * @param {boolean} updated
 * @returns {Object}
 */
const flushResult = (item, updated = true) => ({
    id: item.candidate.id,
    _uuid: item.candidate._uuid,
    resourceType: item.candidate.resourceType,
    created: false,
    updated
});

describe('PatchWriter', () => {
    const serializerConfigManagerBefore = BaseSerializer.configManager;

    beforeAll(() => {
        BaseSerializer.setConfigManager(new ConfigManager());
    });

    afterAll(() => {
        BaseSerializer.setConfigManager(serializerConfigManagerBefore);
    });

    test('queuesReplaceByUuidWithoutVersionFilter', async () => {
        const fakes = buildWriter();
        const context = buildContext();
        const item = buildItem();

        await buildStep(fakes).runAsync({ items: [item], context });

        expect(fakes.databaseBulkInserter.replaceOneAsync.mock.calls).toStrictEqual([[{
            requestInfo: context.requestInfo,
            resourceType: 'Patient',
            doc: item.candidate,
            uuid: 'uuid-0',
            contextData: { resourceType: 'Patient' }
        }]]);
        expect(fakes.databaseBulkInserter.mergeOneAsync).not.toHaveBeenCalled();
        expect(fakes.databaseBulkInserter.insertOneAsync).not.toHaveBeenCalled();
        expect(fakes.databaseBulkInserter.executeAsync).not.toHaveBeenCalled();
        expect(item.status).toBe(WRITE_ITEM_STATUS.QUEUED);
    });

    test('write-serializes the candidate before it is queued, as the old path does', async () => {
        const fakes = buildWriter();
        const item = buildItem({
            resourceType: 'Group',
            candidateFields: {
                type: 'person',
                actual: true,
                _extended: undefined,
                notAFhirField: 'dropped',
                meta: {
                    versionId: '2',
                    lastUpdated: LAST_UPDATED,
                    security: [
                        { system: 'https://www.icanbwell.com/owner', code: 'owner' },
                        { system: 'https://www.icanbwell.com/access', code: 'other-owner' }
                    ]
                }
            }
        });

        await fakes.writer.queueUpdateAsync({ item, context: buildContext() });

        const [[{ doc }]] = fakes.databaseBulkInserter.replaceOneAsync.mock.calls;
        expect(doc).toBe(item.candidate);
        expect(Object.keys(doc)).not.toContain('_extended');
        expect(Object.keys(doc)).not.toContain('notAFhirField');
        expect(doc.meta.security.map(({ system, code }) => ({ system, code }))).toStrictEqual([
            { system: 'https://www.icanbwell.com/owner', code: 'owner' },
            { system: 'https://www.icanbwell.com/access', code: 'other-owner' }
        ]);
        expect(doc.meta.security.every((tag) => isUuid(tag.id))).toBe(true);
    });

    test('marks the stored GridFS files inactive for the removed and replaced paths only, before the document is queued', async () => {
        const fakes = buildWriter();
        const appliedPatch = [
            { op: 'add', path: '/photo/1', value: { contentType: 'image/png' } },
            { op: 'remove', path: '/photo/0' },
            { op: 'replace', path: '/gender', value: 'female' }
        ];
        const item = buildItem({ appliedPatch });

        await fakes.writer.queueUpdateAsync({ item, context: buildContext() });

        expect(fakes.databaseAttachmentManager.transformAttachments.mock.calls).toStrictEqual([[
            item.stored,
            DELETE,
            [
                { op: 'remove', path: '/photo/0' },
                { op: 'replace', path: '/gender', value: 'female' }
            ]
        ]]);
        expect(fakes.log).toStrictEqual(['markGridFsInactive', 'replaceOne']);
    });

    test('commits an extended Group\'s member rows with the candidate\'s version, last-updated and security tags before the Group is queued', async () => {
        const fakes = buildWriter();
        const context = buildContext();
        const memberWrites = extendedWrites();
        const item = buildItem({
            resourceType: 'Group',
            candidateFields: { _extended: true },
            appliedPatch: [],
            memberWrites
        });

        await fakes.writer.queueUpdateAsync({ item, context });

        expect(fakes.groupMemberPatchStrategy.commitPendingMemberWrites.mock.calls).toStrictEqual([[{
            requestInfo: context.requestInfo,
            base_version: '4_0_0',
            groupUuid: 'uuid-0',
            groupVersionId: 2,
            groupLastUpdated: LAST_UPDATED,
            sourceAssigningAuthority: 'owner',
            securityTags: item.candidate.meta.security,
            pendingMemberWrites: memberWrites.pendingMemberWrites
        }]]);
        expect(fakes.log).toStrictEqual(['markGridFsInactive', 'commitExtendedMembers', 'replaceOne']);
    });

    test('does not commit member rows for an extended Group with no pending member writes', async () => {
        const fakes = buildWriter();
        const item = buildItem({
            resourceType: 'Group',
            candidateFields: { _extended: true },
            memberWrites: extendedWrites({ memberOperationCount: 1, hasPendingMemberWrites: false })
        });

        await fakes.writer.queueUpdateAsync({ item, context: buildContext() });

        expect(fakes.groupMemberPatchStrategy.commitPendingMemberWrites).not.toHaveBeenCalled();
        expect(fakes.log).toStrictEqual(['markGridFsInactive', 'replaceOne']);
    });

    test('promotes an over-limit embedded Group, writing the promotion rows before the Group is queued without its members', async () => {
        const fakes = buildWriter();
        const item = buildItem({
            resourceType: 'Group',
            candidateFields: { member: members(PROMOTION_LIMIT + 1) },
            appliedPatch: [{ op: 'add', path: '/member/-', value: members(1)[0] }]
        });

        await fakes.writer.queueUpdateAsync({ item, context: buildContext() });

        expect(fakes.log).toStrictEqual([
            'markGridFsInactive',
            'promotion:removeMembersNotAtVersion',
            'promotion:resolveMemberWrites',
            'promotion:applyResolvedMemberWrites',
            'replaceOne'
        ]);
        const [[{ doc }]] = fakes.databaseBulkInserter.replaceOneAsync.mock.calls;
        expect(doc.member).toBeUndefined();
        expect(doc._extended).toBe(true);
    });

    test('does not promote an embedded Group within the limit', async () => {
        const fakes = buildWriter();
        const item = buildItem({
            resourceType: 'Group',
            candidateFields: { member: members(PROMOTION_LIMIT) }
        });

        await fakes.writer.queueUpdateAsync({ item, context: buildContext() });

        expect(fakes.log).toStrictEqual(['markGridFsInactive', 'replaceOne']);
        const [[{ doc }]] = fakes.databaseBulkInserter.replaceOneAsync.mock.calls;
        expect(doc.member).toStrictEqual(members(PROMOTION_LIMIT));
        expect(doc._extended).toBeUndefined();
    });

    test.each([
        { name: 'with no member operation', memberWrites: null, groupMemberEventsWritten: {} },
        {
            name: 'with member operations',
            memberWrites: externalStorageWrites(),
            groupMemberEventsWritten: { groupMemberEventsWritten: true }
        }
    ])('queues a promoted Group with context data rebuilt from the promoted document, $name', async ({
        memberWrites,
        groupMemberEventsWritten
    }) => {
        const fakes = buildWriter();
        const context = buildContext();
        const preBuiltContextData = {
            groupMembers: members(PROMOTION_LIMIT + 1),
            resourceType: 'Group',
            resourceId: 'resource-0',
            useExternalStorage: true,
            smartMerge: false
        };
        const item = buildItem({
            resourceType: 'Group',
            candidateFields: { member: members(PROMOTION_LIMIT + 1) },
            memberWrites,
            contextData: preBuiltContextData
        });

        await fakes.writer.queueUpdateAsync({ item, context });

        const [[{ doc, contextData }]] = fakes.databaseBulkInserter.replaceOneAsync.mock.calls;
        expect(doc._extended).toBe(true);
        expect(contextData).not.toBe(preBuiltContextData);
        expect(contextData).toStrictEqual({
            ...buildContextDataForHybridStorage('Group', doc, context.requestInfo),
            ...groupMemberEventsWritten
        });
        expect(contextData.groupMembers).toBeUndefined();
        expect(contextData.useExternalStorage).toBe(false);
        expect(item.contextData).toBe(contextData);
    });

    test('keeps the context data object of an item that was not promoted', async () => {
        const fakes = buildWriter();
        const preBuiltContextData = {
            groupMembers: members(PROMOTION_LIMIT),
            resourceType: 'Group',
            resourceId: 'resource-0',
            useExternalStorage: true,
            smartMerge: false
        };
        const item = buildItem({
            resourceType: 'Group',
            candidateFields: { member: members(PROMOTION_LIMIT) },
            contextData: preBuiltContextData
        });

        await fakes.writer.queueUpdateAsync({ item, context: buildContext() });

        const [[{ contextData }]] = fakes.databaseBulkInserter.replaceOneAsync.mock.calls;
        expect(contextData).toBe(preBuiltContextData);
        expect(contextData).toStrictEqual({
            groupMembers: members(PROMOTION_LIMIT),
            resourceType: 'Group',
            resourceId: 'resource-0',
            useExternalStorage: true,
            smartMerge: false
        });
    });

    test.each([
        { name: 'a non-Group or embedded Group', memberWrites: null, expected: undefined },
        { name: 'an extended Group with member operations', memberWrites: extendedWrites(), expected: true },
        {
            name: 'an extended Group with no member operation',
            memberWrites: extendedWrites({ memberOperationCount: 0, hasPendingMemberWrites: false }),
            expected: undefined
        },
        {
            name: 'an external-storage Group with member operations',
            memberWrites: externalStorageWrites(),
            expected: true
        },
        {
            name: 'an external-storage Group with no member operation',
            memberWrites: externalStorageWrites({ memberOperationCount: 0 }),
            expected: undefined
        }
    ])('sets groupMemberEventsWritten only when member operations exist: $name', async ({ memberWrites, expected }) => {
        const fakes = buildWriter();
        const item = buildItem({
            resourceType: 'Group',
            candidateFields: memberWrites?.type === 'extended' ? { _extended: true } : {},
            memberWrites,
            contextData: { resourceType: 'Group', useExternalStorage: false }
        });

        await fakes.writer.queueUpdateAsync({ item, context: buildContext() });

        const [[{ contextData }]] = fakes.databaseBulkInserter.replaceOneAsync.mock.calls;
        expect(contextData.groupMemberEventsWritten).toBe(expected);
    });

    test('queues a null context data as null when member operations exist', async () => {
        const fakes = buildWriter();
        const item = buildItem({
            resourceType: 'Group',
            memberWrites: externalStorageWrites(),
            contextData: null
        });

        await fakes.writer.queueUpdateAsync({ item, context: buildContext() });

        const [[{ contextData }]] = fakes.databaseBulkInserter.replaceOneAsync.mock.calls;
        expect(contextData).toBeNull();
    });

    test('an error from the member strategy fails only that item at WRITE, wrapped as WriteStep does', async () => {
        const strategyError = new Error('member rows not written');
        const fakes = buildWriter({ strategyError });
        const failing = buildItem({
            index: 0,
            resourceType: 'Group',
            candidateFields: { _extended: true },
            memberWrites: extendedWrites()
        });
        const passing = buildItem({ index: 1 });

        await buildStep(fakes).runAsync({ items: [failing, passing], context: buildContext() });

        expect(failing.status).toBe(WRITE_ITEM_STATUS.FAILED);
        expect(failing.failure.stage).toBe(WRITE_FAILURE_STAGE.WRITE);
        expect(failing.failure.error).toBeInstanceOf(RethrownError);
        expect(failing.failure.error.message).toContain('Error updating: resource_uuid=uuid-0');
        expect(passing.status).toBe(WRITE_ITEM_STATUS.QUEUED);
        expect(fakes.databaseBulkInserter.replaceOneAsync.mock.calls.map(([args]) => args.uuid))
            .toStrictEqual(['uuid-1']);
    });

    test('an insert fails at WRITE because PATCH never inserts', async () => {
        const fakes = buildWriter();
        const item = buildItem();
        item.writeMode = 'insert';

        await buildStep(fakes).runAsync({ items: [item], context: buildContext() });

        expect(item.status).toBe(WRITE_ITEM_STATUS.FAILED);
        expect(item.failure.stage).toBe(WRITE_FAILURE_STAGE.WRITE);
        expect(item.failure.error.message).toContain('Error inserting: resource_uuid=uuid-0');
        expect(fakes.databaseBulkInserter.insertOneAsync).not.toHaveBeenCalled();
        expect(fakes.databaseBulkInserter.replaceOneAsync).not.toHaveBeenCalled();
    });

    test('afterFlushAsync writes an updated external-storage Group\'s ClickHouse events with the new version', async () => {
        const fakes = buildWriter();
        const context = buildContext();
        const memberWrites = externalStorageWrites();
        const item = buildItem({ resourceType: 'Group', memberWrites });
        const step = buildStep(fakes);
        await step.runAsync({ items: [item], context });

        await step.afterFlushAsync({ items: [item], context, executedResults: [flushResult(item)] });

        expect(fakes.groupMemberPatchStrategy.writeClickHouseMemberEventsAsync.mock.calls).toStrictEqual([[{
            resourceType: 'Group',
            groupId: 'resource-0',
            events: memberWrites.events,
            groupResource: item.candidate
        }]]);
        expect(fakes.log).toStrictEqual(['markGridFsInactive', 'replaceOne', 'writeClickHouseEvents']);
    });

    test.each([
        {
            name: 'a failed write',
            arrange: (item) => item.fail({ failure: { stage: WRITE_FAILURE_STAGE.WRITE } }),
            executedResults: (item) => [flushResult(item)]
        },
        {
            name: 'a no-op with no candidate',
            arrange: (item) => {
                item.candidate = null;
                item.markUnchanged();
            },
            executedResults: (item) => [flushResult(item)]
        },
        {
            name: 'a queued item with no flush result',
            arrange: (item) => item.markQueued(),
            executedResults: () => []
        },
        {
            name: 'a queued item whose flush result is not updated',
            arrange: (item) => item.markQueued(),
            executedResults: (item) => [flushResult(item, false)]
        },
        {
            name: 'a queued item whose flush result is for another resource',
            arrange: (item) => item.markQueued(),
            executedResults: () => [{ _uuid: 'uuid-other', resourceType: 'Group', updated: true }]
        },
        {
            name: 'a queued embedded Group',
            arrange: (item) => {
                item.memberWrites = null;
                item.markQueued();
            },
            executedResults: (item) => [flushResult(item)]
        },
        {
            name: 'a queued extended Group',
            arrange: (item) => {
                item.memberWrites = extendedWrites();
                item.markQueued();
            },
            executedResults: (item) => [flushResult(item)]
        }
    ])('afterFlushAsync writes no ClickHouse event for $name', async ({ arrange, executedResults }) => {
        const fakes = buildWriter();
        const item = buildItem({ resourceType: 'Group', memberWrites: externalStorageWrites() });
        const results = executedResults(item);
        arrange(item);

        await buildStep(fakes).afterFlushAsync({
            items: [item],
            context: buildContext(),
            executedResults: results
        });

        expect(fakes.groupMemberPatchStrategy.writeClickHouseMemberEventsAsync).not.toHaveBeenCalled();
    });

    test('afterFlushAsync throws an error from the member strategy', async () => {
        const strategyError = new Error('events not written');
        const fakes = buildWriter({ strategyError });
        const item = buildItem({ resourceType: 'Group', memberWrites: externalStorageWrites() });
        item.markQueued();

        await expect(buildStep(fakes).afterFlushAsync({
            items: [item],
            context: buildContext(),
            executedResults: [flushResult(item)]
        })).rejects.toBe(strategyError);
    });
});
