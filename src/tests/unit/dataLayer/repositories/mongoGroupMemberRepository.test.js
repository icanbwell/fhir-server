const { describe, test, expect, beforeEach, jest } = require('@jest/globals');

const { MongoGroupMemberRepository } = require('../../../../dataLayer/repositories/mongoGroupMemberRepository');
const { DatabaseQueryFactory } = require('../../../../dataLayer/databaseQueryFactory');
const { FastDatabaseBulkInserter } = require('../../../../dataLayer/fastDatabaseBulkInserter');
const { RemoveHelper } = require('../../../../operations/remove/removeHelper');
const { ResourceLocatorFactory } = require('../../../../operations/common/resourceLocatorFactory');

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

    beforeEach(() => {
        mockDatabaseQueryFactory = createMockInstance(DatabaseQueryFactory);
        mockDatabaseBulkInserter = createMockInstance(FastDatabaseBulkInserter);
        mockRemoveHelper = createMockInstance(RemoveHelper);
        mockResourceLocator = { getHistoryCollectionAsync: jest.fn() };
        mockResourceLocatorFactory = createMockInstance(ResourceLocatorFactory, {
            createResourceLocator: jest.fn().mockReturnValue(mockResourceLocator)
        });

        repository = new MongoGroupMemberRepository({
            databaseQueryFactory: mockDatabaseQueryFactory,
            fastDatabaseBulkInserter: mockDatabaseBulkInserter,
            removeHelper: mockRemoveHelper,
            resourceLocatorFactory: mockResourceLocatorFactory
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
});
