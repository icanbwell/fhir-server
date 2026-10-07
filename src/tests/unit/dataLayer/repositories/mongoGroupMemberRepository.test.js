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
            fastDatabaseBulkInserter: mockDatabaseBulkInserter,
            removeHelper: mockRemoveHelper
        });
    });

    describe('getPatientMemberReferencesPageAsync', () => {
        let findAsyncMock;
        let rows;

        beforeEach(() => {
            rows = [{ _uuid: 'a', member: { entity: { reference: 'Patient/p1' } } }];
            findAsyncMock = jest.fn().mockResolvedValue({ toArrayAsync: jest.fn().mockResolvedValue(rows) });
            mockDatabaseQueryFactory.createQuery = jest.fn().mockReturnValue({ findAsync: findAsyncMock });
        });

        test('first page: Patient-prefix filter, _uuid sort, limit, projection, no seek bound', async () => {
            const result = await repository.getPatientMemberReferencesPageAsync({
                base_version: '4_0_0', groupUuid: 'group-123', afterUuid: null, limit: 2
            });

            expect(mockDatabaseQueryFactory.createQuery).toHaveBeenCalledWith({
                resourceType: 'GroupMember', base_version: '4_0_0'
            });
            expect(findAsyncMock).toHaveBeenCalledWith({
                query: { groupUuid: 'group-123', 'member.entity.reference': { $regex: /^Patient\// } },
                options: {
                    projection: { _id: 0, _uuid: 1, 'member.entity.reference': 1 },
                    sort: { _uuid: 1 },
                    limit: 2
                }
            });
            expect(result).toBe(rows);
        });

        test('subsequent page: seeks strictly after afterUuid', async () => {
            await repository.getPatientMemberReferencesPageAsync({
                base_version: '4_0_0', groupUuid: 'group-123', afterUuid: 'a', limit: 2
            });

            expect(findAsyncMock.mock.calls[0][0].query).toEqual({
                groupUuid: 'group-123',
                'member.entity.reference': { $regex: /^Patient\// },
                _uuid: { $gt: 'a' }
            });
        });

        test('does not filter on member.inactive', async () => {
            await repository.getPatientMemberReferencesPageAsync({
                base_version: '4_0_0', groupUuid: 'group-123', afterUuid: null, limit: 2
            });

            expect(findAsyncMock.mock.calls[0][0].query).not.toHaveProperty(['member.inactive']);
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
});
