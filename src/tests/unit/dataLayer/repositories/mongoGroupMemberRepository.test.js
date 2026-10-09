const { describe, test, expect, beforeEach, jest } = require('@jest/globals');

const { MongoGroupMemberRepository } = require('../../../../dataLayer/repositories/mongoGroupMemberRepository');
const { DatabaseQueryFactory } = require('../../../../dataLayer/databaseQueryFactory');
const { FastDatabaseBulkInserter } = require('../../../../dataLayer/fastDatabaseBulkInserter');
const { RemoveHelper } = require('../../../../operations/remove/removeHelper');
const { ResourceLocatorFactory } = require('../../../../operations/common/resourceLocatorFactory');
const { ConfigManager } = require('../../../../utils/configManager');

function createMockInstance (ClassRef, methods = {}) {
    const instance = Object.create(ClassRef.prototype);
    Object.assign(instance, methods);
    return instance;
}

describe('MongoGroupMemberRepository', () => {
    let repository;
    let mockDatabaseQueryFactory;
    let mockDatabaseBulkInserter;
    let mockRemoveHelper;
    let mockResourceLocatorFactory;
    let mockResourceLocator;
    let mockConfigManager;

    beforeEach(() => {
        mockDatabaseQueryFactory = createMockInstance(DatabaseQueryFactory);
        mockDatabaseBulkInserter = createMockInstance(FastDatabaseBulkInserter);
        mockRemoveHelper = createMockInstance(RemoveHelper);
        mockResourceLocator = { getHistoryCollectionAsync: jest.fn() };
        mockResourceLocatorFactory = createMockInstance(ResourceLocatorFactory, {
            createResourceLocator: jest.fn().mockReturnValue(mockResourceLocator)
        });

        mockConfigManager = createMockInstance(ConfigManager);
        Object.defineProperty(mockConfigManager, 'groupMemberCascadeDeleteBatchSize', { get: () => 2 });

        repository = new MongoGroupMemberRepository({
            databaseQueryFactory: mockDatabaseQueryFactory,
            fastDatabaseBulkInserter: mockDatabaseBulkInserter,
            removeHelper: mockRemoveHelper,
            resourceLocatorFactory: mockResourceLocatorFactory,
            configManager: mockConfigManager
        });
    });

    describe('getMemberCursorAsync', () => {
        test('queries the GroupMember collection scoped by groupUuid and returns the resulting cursor', async () => {
            const fakeCursor = { toArrayAsync: jest.fn() };
            const findAsyncMock = jest.fn().mockResolvedValue(fakeCursor);
            mockDatabaseQueryFactory.createQuery = jest.fn().mockReturnValue({ findAsync: findAsyncMock });

            const result = await repository.getMemberCursorAsync({
                base_version: '4_0_0',
                groupUuid: 'group-123'
            });

            expect(mockDatabaseQueryFactory.createQuery).toHaveBeenCalledWith({
                resourceType: 'GroupMember',
                base_version: '4_0_0'
            });
            expect(findAsyncMock).toHaveBeenCalledWith({
                query: { groupUuid: 'group-123' }
            });
            expect(result).toBe(fakeCursor);
        });

        test('scopes strictly by the given groupUuid -- a different group\'s rows never leak into the query', async () => {
            const findAsyncMock = jest.fn().mockResolvedValue({});
            mockDatabaseQueryFactory.createQuery = jest.fn().mockReturnValue({ findAsync: findAsyncMock });

            await repository.getMemberCursorAsync({ base_version: '4_0_0', groupUuid: 'group-A' });

            const queryArg = findAsyncMock.mock.calls[0][0].query;
            expect(queryArg).toEqual({ groupUuid: 'group-A' });
            expect(queryArg.groupUuid).not.toBe('group-B');
        });

        test('propagates rejection from findAsync instead of swallowing it', async () => {
            const error = new Error('mongo exploded');
            mockDatabaseQueryFactory.createQuery = jest.fn().mockReturnValue({
                findAsync: jest.fn().mockRejectedValue(error)
            });

            await expect(
                repository.getMemberCursorAsync({ base_version: '4_0_0', groupUuid: 'group-x' })
            ).rejects.toThrow('mongo exploded');
        });
    });

    describe('removeMembersNotAtVersionAsync', () => {
        const requestInfo = { requestId: 'req-1', method: 'PATCH', headers: {} };

        function mockFind (rows) {
            const findAsyncMock = jest.fn().mockResolvedValue({ toArrayAsync: jest.fn().mockResolvedValue(rows) });
            mockDatabaseQueryFactory.createQuery = jest.fn().mockReturnValue({ findAsync: findAsyncMock });
            mockRemoveHelper.deleteManyAsync = jest.fn().mockResolvedValue(undefined);
            return findAsyncMock;
        }

        test('queries the group\'s rows whose versionId is not the given version, as an exact string', async () => {
            const findAsyncMock = mockFind([]);

            await repository.removeMembersNotAtVersionAsync({
                requestInfo, base_version: '4_0_0', groupUuid: 'group-1', versionId: 10
            });

            expect(mockDatabaseQueryFactory.createQuery).toHaveBeenCalledWith({
                resourceType: 'GroupMember',
                base_version: '4_0_0'
            });
            expect(findAsyncMock).toHaveBeenCalledWith({
                query: { groupUuid: 'group-1', 'meta.versionId': { $ne: '10' } }
            });
        });

        test('deletes the rows it found as DELETE tombstones and returns how many', async () => {
            const rows = [{ _uuid: 'row-1' }, { _uuid: 'row-2' }];
            mockFind(rows);

            const removed = await repository.removeMembersNotAtVersionAsync({
                requestInfo, base_version: '4_0_0', groupUuid: 'group-1', versionId: 3
            });

            expect(removed).toBe(2);
            expect(mockRemoveHelper.deleteManyAsync).toHaveBeenCalledTimes(1);
            const deleteArgs = mockRemoveHelper.deleteManyAsync.mock.calls[0][0];
            expect(deleteArgs.resources).toBe(rows);
            expect(deleteArgs.resourceType).toBe('GroupMember');
            expect(deleteArgs.requestInfo.method).toBe('DELETE');
        });

        test('does not call the remove helper when every row is at the version', async () => {
            mockFind([]);

            const removed = await repository.removeMembersNotAtVersionAsync({
                requestInfo, base_version: '4_0_0', groupUuid: 'group-1', versionId: 3
            });

            expect(removed).toBe(0);
            expect(mockRemoveHelper.deleteManyAsync).not.toHaveBeenCalled();
        });
    });

    describe('applyResolvedMemberWritesAsync', () => {
        const requestInfo = { requestId: 'req-1' };

        function buildParams (resolvedMemberWrites) {
            return {
                requestInfo,
                base_version: '4_0_0',
                groupUuid: 'group-a',
                groupVersionId: 2,
                groupLastUpdated: new Date('2026-09-29T00:00:00.000Z'),
                sourceAssigningAuthority: 'bwell',
                securityTags: [],
                resolvedMemberWrites
            };
        }

        function resolvedWrite (reference, writeType) {
            return {
                writeRequest: { entity: { reference } },
                writeType,
                member: { entity: { reference } }
            };
        }

        beforeEach(() => {
            mockDatabaseBulkInserter.insertOneAsync = jest.fn().mockResolvedValue(undefined);
            mockDatabaseBulkInserter.replaceOneAsync = jest.fn().mockResolvedValue(undefined);
            mockDatabaseBulkInserter.executeAsync = jest.fn().mockResolvedValue([]);
        });

        test('stages creates/updates and flushes them before returning', async () => {
            const outcomes = await repository.applyResolvedMemberWritesAsync(buildParams(new Map([
                ['member-a-1', resolvedWrite('Patient/1', 'create')],
                ['member-a-2', resolvedWrite('Patient/2', 'update')]
            ])));

            expect(mockDatabaseBulkInserter.insertOneAsync).toHaveBeenCalledTimes(1);
            expect(mockDatabaseBulkInserter.replaceOneAsync).toHaveBeenCalledTimes(1);
            expect(mockDatabaseBulkInserter.executeAsync).toHaveBeenCalledWith({ requestInfo, base_version: '4_0_0' });
            expect(outcomes).toEqual([
                { reference: 'Patient/1', operation: 'create' },
                { reference: 'Patient/2', operation: 'update' }
            ]);
        });

        test('throws when any member write comes back with an issue', async () => {
            mockDatabaseBulkInserter.executeAsync.mockResolvedValue([
                { _uuid: 'member-a-1', resourceType: 'GroupMember', created: true },
                { _uuid: 'member-a-2', resourceType: 'GroupMember', created: false, issue: { severity: 'error', code: 'exception' } }
            ]);

            await expect(
                repository.applyResolvedMemberWritesAsync(buildParams(new Map([
                    ['member-a-1', resolvedWrite('Patient/1', 'create')],
                    ['member-a-2', resolvedWrite('Patient/2', 'create')]
                ])))
            ).rejects.toThrow('Error writing Group members');
        });

        test('does not flush when every write resolved to none', async () => {
            await repository.applyResolvedMemberWritesAsync(buildParams(new Map([
                ['member-a-1', resolvedWrite('Patient/1', 'none')]
            ])));

            expect(mockDatabaseBulkInserter.executeAsync).not.toHaveBeenCalled();
        });
    });

    describe('getMemberCursorAtAsync', () => {
        test('queries the GroupMember history collection, not the live one', async () => {
            const fakeCursor = {};
            mockResourceLocator.getHistoryCollectionAsync.mockResolvedValue({
                aggregate: jest.fn().mockReturnValue(fakeCursor)
            });

            const result = await repository.getMemberCursorAtAsync({
                base_version: '4_0_0',
                groupUuid: 'group-123',
                targetLastUpdated: new Date('2026-01-01T00:00:00.000Z')
            });

            expect(mockResourceLocatorFactory.createResourceLocator).toHaveBeenCalledWith({
                resourceType: 'GroupMember',
                base_version: '4_0_0'
            });
            expect(mockResourceLocator.getHistoryCollectionAsync).toHaveBeenCalled();
            expect(result).toBe(fakeCursor);
        });

        test('matches by groupUuid and lastUpdated <= target, sorts/groups by _uuid keeping the ' +
            'latest row, excludes DELETE tombstones, and unwraps to the plain resource', async () => {
            const aggregateMock = jest.fn().mockReturnValue({});
            mockResourceLocator.getHistoryCollectionAsync.mockResolvedValue({ aggregate: aggregateMock });
            const target = new Date('2026-01-01T00:00:00.000Z');

            await repository.getMemberCursorAtAsync({
                base_version: '4_0_0',
                groupUuid: 'group-123',
                targetLastUpdated: target
            });

            expect(aggregateMock).toHaveBeenCalledWith([
                {
                    $match: {
                        'resource.groupUuid': 'group-123',
                        'resource.meta.lastUpdated': { $lte: target }
                    }
                },
                // Key order/directions here must match customIndexes.js's
                // GroupMember_4_0_0_History compound index exactly, or MongoDB falls back to an
                // in-memory SORT/GROUP instead of walking the index directly.
                {
                    $sort: {
                        'resource._uuid': 1,
                        'resource.meta.lastUpdated': -1,
                        _id: 1
                    }
                },
                {
                    $group: {
                        _id: '$resource._uuid',
                        latest: { $first: '$$ROOT' }
                    }
                },
                {
                    $match: {
                        'latest.request.method': { $ne: 'DELETE' }
                    }
                },
                {
                    $replaceRoot: { newRoot: '$latest.resource' }
                }
            ]);
        });

        test('propagates rejection from getHistoryCollectionAsync instead of swallowing it', async () => {
            const error = new Error('history collection unavailable');
            mockResourceLocator.getHistoryCollectionAsync.mockRejectedValue(error);

            await expect(
                repository.getMemberCursorAtAsync({
                    base_version: '4_0_0',
                    groupUuid: 'group-123',
                    targetLastUpdated: new Date()
                })
            ).rejects.toThrow('history collection unavailable');
        });

        test('adds a resource._uuid > afterUuid bound and a maxTimeMS option when resuming a ' +
            'stream past a mid-read failure', async () => {
            const aggregateMock = jest.fn().mockReturnValue({});
            mockResourceLocator.getHistoryCollectionAsync.mockResolvedValue({ aggregate: aggregateMock });
            const target = new Date('2026-01-01T00:00:00.000Z');

            await repository.getMemberCursorAtAsync({
                base_version: '4_0_0',
                groupUuid: 'group-123',
                targetLastUpdated: target,
                afterUuid: 'row-uuid-5',
                maxTimeMS: 60000
            });

            const [pipeline, options] = aggregateMock.mock.calls[0];
            expect(pipeline[0].$match).toEqual({
                'resource.groupUuid': 'group-123',
                'resource.meta.lastUpdated': { $lte: target },
                'resource._uuid': { $gt: 'row-uuid-5' }
            });
            expect(options).toEqual({ maxTimeMS: 60000 });
        });

        test('passes no options argument when maxTimeMS is not given', async () => {
            const aggregateMock = jest.fn().mockReturnValue({});
            mockResourceLocator.getHistoryCollectionAsync.mockResolvedValue({ aggregate: aggregateMock });

            await repository.getMemberCursorAtAsync({
                base_version: '4_0_0',
                groupUuid: 'group-123',
                targetLastUpdated: new Date()
            });

            expect(aggregateMock.mock.calls[0]).toHaveLength(1);
        });
    });

    describe('cascadeDeleteForGroupAsync', () => {
        const requestInfo = { requestId: 'req-1', method: 'DELETE', user: 'u', headers: {} };
        const makeRow = (n) => ({
            resourceType: 'GroupMember',
            id: `m-${n}`,
            _uuid: `m-${n}`,
            groupUuid: 'group-1',
            meta: { versionId: '2', lastUpdated: new Date('2026-01-01T00:00:00.000Z') },
            member: { entity: { _uuid: `p-${n}` } }
        });

        let findAsyncMock;

        /**
         * @param {Array<Array<Object>>} rounds - rows returned by successive find calls; an empty
         *   array is appended automatically so the loop terminates
         */
        function mockRounds(rounds) {
            findAsyncMock = jest.fn();
            for (const rows of [...rounds, []]) {
                findAsyncMock.mockResolvedValueOnce({ toArrayAsync: jest.fn().mockResolvedValue(rows) });
            }
            mockDatabaseQueryFactory.createQuery = jest.fn().mockReturnValue({ findAsync: findAsyncMock });
            mockRemoveHelper.deleteManyAsync = jest.fn().mockImplementation(async ({ resources }) => resources.length);
        }

        test('re-queries until the roster is empty, deleting one batchSize batch at a time', async () => {
            mockRounds([[makeRow(1), makeRow(2)], [makeRow(3), makeRow(4)], [makeRow(5)]]);

            const deleted = await repository.cascadeDeleteForGroupAsync({
                requestInfo, base_version: '4_0_0', groupUuid: 'group-1'
            });

            expect(deleted).toBe(5);
            expect(findAsyncMock).toHaveBeenCalledTimes(4);
            for (const call of findAsyncMock.mock.calls) {
                expect(call[0]).toEqual({
                    query: { groupUuid: 'group-1' },
                    options: { limit: 2, projection: { _id: 0 } }
                });
            }
            const batchSizes = mockRemoveHelper.deleteManyAsync.mock.calls.map(c => c[0].resources.length);
            expect(batchSizes).toEqual([2, 2, 1]);
        });

        test('returns 0 and deletes nothing when the Group has no member rows', async () => {
            mockRounds([]);

            const deleted = await repository.cascadeDeleteForGroupAsync({
                requestInfo, base_version: '4_0_0', groupUuid: 'group-1'
            });

            expect(deleted).toBe(0);
            expect(mockRemoveHelper.deleteManyAsync).not.toHaveBeenCalled();
        });

        test('hands the live rows to RemoveHelper unchanged, so each tombstone is the row\'s own last-known state', async () => {
            const row = makeRow(1);
            const snapshot = JSON.parse(JSON.stringify(row));
            mockRounds([[row]]);

            await repository.cascadeDeleteForGroupAsync({ requestInfo, base_version: '4_0_0', groupUuid: 'group-1' });

            const [{ resources }] = mockRemoveHelper.deleteManyAsync.mock.calls[0];
            expect(resources).toEqual([row]);
            expect(resources[0]).toBe(row);
            expect(JSON.parse(JSON.stringify(row))).toEqual(snapshot);
        });

        test('calls RemoveHelper as a batch delete with the DELETE method and without preserveLastUpdated', async () => {
            mockRounds([[makeRow(1)]]);

            await repository.cascadeDeleteForGroupAsync({
                requestInfo: { ...requestInfo, method: 'PATCH' }, base_version: '4_0_0', groupUuid: 'group-1'
            });

            const [args] = mockRemoveHelper.deleteManyAsync.mock.calls[0];
            expect(args.requestInfo.method).toBe('DELETE');
            expect(args.requestInfo.requestId).toBe('req-1');
            expect(args.resourceType).toBe('GroupMember');
            expect(args.base_version).toBe('4_0_0');
            expect(args.skipRequestScopedBuffering).toBe(true);
            expect(args).not.toHaveProperty('preserveLastUpdated');
        });

        test('deletes the batches sequentially: the next batch is not queried until the previous is deleted', async () => {
            mockRounds([[makeRow(1), makeRow(2)], [makeRow(3)]]);
            const events = [];
            mockDatabaseQueryFactory.createQuery = jest.fn().mockReturnValue({
                findAsync: jest.fn().mockImplementation(async (args) => {
                    events.push('find');
                    return await findAsyncMock(args);
                })
            });
            mockRemoveHelper.deleteManyAsync = jest.fn().mockImplementation(async ({ resources }) => {
                events.push('delete');
                return resources.length;
            });

            await repository.cascadeDeleteForGroupAsync({ requestInfo, base_version: '4_0_0', groupUuid: 'group-1' });

            expect(events).toEqual(['find', 'delete', 'find', 'delete', 'find']);
        });

        test('throws instead of looping forever when rows are found but none are deleted', async () => {
            mockRounds([[makeRow(1), makeRow(2)], [makeRow(1), makeRow(2)]]);
            mockRemoveHelper.deleteManyAsync = jest.fn().mockResolvedValue(0);

            await expect(
                repository.cascadeDeleteForGroupAsync({ requestInfo, base_version: '4_0_0', groupUuid: 'group-1' })
            ).rejects.toThrow(/no progress/);
            expect(findAsyncMock).toHaveBeenCalledTimes(1);
        });

        test('propagates a failed batch and stops without querying further batches', async () => {
            mockRounds([[makeRow(1), makeRow(2)], [makeRow(3)]]);
            mockRemoveHelper.deleteManyAsync = jest.fn()
                .mockResolvedValueOnce(2)
                .mockRejectedValueOnce(new Error('mongo down'));

            await expect(
                repository.cascadeDeleteForGroupAsync({ requestInfo, base_version: '4_0_0', groupUuid: 'group-1' })
            ).rejects.toThrow('mongo down');
            expect(findAsyncMock).toHaveBeenCalledTimes(2);
        });
    });
});
