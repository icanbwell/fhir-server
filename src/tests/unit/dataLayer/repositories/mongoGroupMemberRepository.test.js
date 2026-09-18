const { describe, test, expect, beforeEach, jest } = require('@jest/globals');

const { MongoGroupMemberRepository } = require('../../../../dataLayer/repositories/mongoGroupMemberRepository');
const { DatabaseQueryFactory } = require('../../../../dataLayer/databaseQueryFactory');
const { FastDatabaseBulkInserter } = require('../../../../dataLayer/fastDatabaseBulkInserter');
const { RemoveHelper } = require('../../../../operations/remove/removeHelper');

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

    beforeEach(() => {
        mockDatabaseQueryFactory = createMockInstance(DatabaseQueryFactory);
        mockDatabaseBulkInserter = createMockInstance(FastDatabaseBulkInserter);
        mockRemoveHelper = createMockInstance(RemoveHelper);

        repository = new MongoGroupMemberRepository({
            databaseQueryFactory: mockDatabaseQueryFactory,
            databaseBulkInserter: mockDatabaseBulkInserter,
            removeHelper: mockRemoveHelper
        });
    });

    describe('getMemberCursorAsync', () => {
        test('queries the GroupMember collection scoped by groupUuid, sorted by memberRowUuid, and returns the resulting cursor', async () => {
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
                query: { groupUuid: 'group-123' },
                options: { sort: { memberRowUuid: 1 } }
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
});
