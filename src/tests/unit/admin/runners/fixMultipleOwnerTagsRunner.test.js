'use strict';

const { describe, test, expect, beforeEach, jest: jestGlobal } = require('@jest/globals');

const { FixMultipleOwnerTagsRunner } = require('../../../../admin/runners/fixMultipleOwnerTagsRunner');
const { AdminLogger } = require('../../../../admin/adminLogger');
const { MongoDatabaseManager } = require('../../../../utils/mongoDatabaseManager');
const { SecurityTagSystem } = require('../../../../utils/securityTagSystem');

function createMockInstance (ClassType) {
    return Object.create(ClassType.prototype);
}

function makeAggregateCursor (results) {
    let i = 0;
    return {
        hasNext: jestGlobal.fn(async () => i < results.length),
        next: jestGlobal.fn(async () => results[i++])
    };
}

describe('FixMultipleOwnerTagsRunner', () => {
    let runner;
    let mockAdminLogger;
    let mockMongoDatabaseManager;

    beforeEach(() => {
        mockAdminLogger = createMockInstance(AdminLogger);
        mockAdminLogger.logInfo = jestGlobal.fn();
        mockAdminLogger.logError = jestGlobal.fn();

        mockMongoDatabaseManager = createMockInstance(MongoDatabaseManager);
        mockMongoDatabaseManager.getClientConfigAsync = jestGlobal.fn().mockResolvedValue({
            connection: 'mongodb://localhost:27017', db_name: 'test_db', options: {}
        });

        runner = new FixMultipleOwnerTagsRunner({
            mongoDatabaseManager: mockMongoDatabaseManager,
            collections: ['Patient_4_0_0'],
            batchSize: 100,
            adminLogger: mockAdminLogger,
            startFromCollection: undefined,
            limit: undefined,
            useTransaction: undefined,
            skip: undefined,
            startFromId: undefined
        });
    });

    // =====================================================
    // removeDuplicateOwnerTags
    // =====================================================
    describe('removeDuplicateOwnerTags', () => {
        test('keeps only the owner tag matching sourceAssigningAuthority, drops the rest', () => {
            const resource = {
                _uuid: 'uuid-1',
                meta: {
                    security: [
                        { system: SecurityTagSystem.owner, code: 'tenantA' },
                        { system: SecurityTagSystem.owner, code: 'tenantB' },
                        { system: SecurityTagSystem.sourceAssigningAuthority, code: 'tenantA' }
                    ]
                }
            };

            const result = runner.removeDuplicateOwnerTags(resource);

            const ownerTags = result.meta.security.filter((s) => s.system === SecurityTagSystem.owner);
            expect(ownerTags).toEqual([{ system: SecurityTagSystem.owner, code: 'tenantA' }]);
        });

        test('leaves non-owner security tags untouched', () => {
            const resource = {
                _uuid: 'uuid-1',
                meta: {
                    security: [
                        { system: SecurityTagSystem.owner, code: 'tenantA' },
                        { system: SecurityTagSystem.sourceAssigningAuthority, code: 'tenantA' },
                        { system: SecurityTagSystem.access, code: 'tenantA' }
                    ]
                }
            };

            const result = runner.removeDuplicateOwnerTags(resource);

            expect(result.meta.security).toContainEqual({ system: SecurityTagSystem.access, code: 'tenantA' });
        });

        test('logs an error and returns the resource unchanged when sourceAssigningAuthority tag is missing', () => {
            const resource = {
                _uuid: 'uuid-1',
                meta: { security: [{ system: SecurityTagSystem.owner, code: 'tenantA' }] }
            };

            const result = runner.removeDuplicateOwnerTags(resource);

            expect(mockAdminLogger.logError).toHaveBeenCalledWith(
                expect.stringContaining('without sourceAssigningAuthority tag')
            );
            expect(result.meta.security).toEqual([{ system: SecurityTagSystem.owner, code: 'tenantA' }]);
        });

        test('is a no-op when the resource has no meta.security at all', () => {
            const resource = { _uuid: 'uuid-1' };
            expect(() => runner.removeDuplicateOwnerTags(resource)).not.toThrow();
            expect(runner.removeDuplicateOwnerTags(resource)).toEqual({ _uuid: 'uuid-1' });
        });

    });

    // =====================================================
    // getResourceUuidsWithMultipleOwnerTagsAsync
    // =====================================================
    describe('getResourceUuidsWithMultipleOwnerTagsAsync', () => {
        let mockCollection;
        let mockSession;
        let mockClient;

        function wireConnection (aggregateResults) {
            mockCollection = { aggregate: jestGlobal.fn().mockReturnValue(makeAggregateCursor(aggregateResults)) };
            mockSession = { endSession: jestGlobal.fn().mockResolvedValue(undefined) };
            mockClient = { close: jestGlobal.fn().mockResolvedValue(undefined) };
            runner.createSingeConnectionAsync = jestGlobal.fn().mockResolvedValue({
                collection: mockCollection, session: mockSession, client: mockClient
            });
        }

        test('groups solely by _uuid (not by system/code pair like the base-class implementation)', async () => {
            wireConnection([]);

            await runner.getResourceUuidsWithMultipleOwnerTagsAsync({ collectionName: 'Patient_4_0_0' });

            const pipeline = mockCollection.aggregate.mock.calls[0][0];
            const groupStage = pipeline.find((stage) => stage.$group);
            expect(groupStage.$group._id).toBe('$_uuid');
        });

        test('matches only meta.security entries tagged as owner', async () => {
            wireConnection([]);

            await runner.getResourceUuidsWithMultipleOwnerTagsAsync({ collectionName: 'Patient_4_0_0' });

            const pipeline = mockCollection.aggregate.mock.calls[0][0];
            expect(pipeline).toContainEqual({ $match: { 'meta.security.system': SecurityTagSystem.owner } });
        });

        test('collects every uuid the aggregation cursor yields', async () => {
            wireConnection([{ _id: 'uuid-1', count: 2 }, { _id: 'uuid-2', count: 3 }]);

            const uuids = await runner.getResourceUuidsWithMultipleOwnerTagsAsync({ collectionName: 'Patient_4_0_0' });

            expect(uuids).toEqual(['uuid-1', 'uuid-2']);
        });

        test('always ends the session and closes the client on success', async () => {
            wireConnection([]);

            await runner.getResourceUuidsWithMultipleOwnerTagsAsync({ collectionName: 'Patient_4_0_0' });

            expect(mockSession.endSession).toHaveBeenCalledTimes(1);
            expect(mockClient.close).toHaveBeenCalledTimes(1);
        });

        test('rethrows a RethrownError and still cleans up the connection when the aggregate fails', async () => {
            mockCollection = { aggregate: jestGlobal.fn(() => { throw new Error('mongo down'); }) };
            mockSession = { endSession: jestGlobal.fn().mockResolvedValue(undefined) };
            mockClient = { close: jestGlobal.fn().mockResolvedValue(undefined) };
            runner.createSingeConnectionAsync = jestGlobal.fn().mockResolvedValue({
                collection: mockCollection, session: mockSession, client: mockClient
            });

            await expect(runner.getResourceUuidsWithMultipleOwnerTagsAsync({ collectionName: 'Patient_4_0_0' }))
                .rejects.toThrow('mongo down');

            expect(mockSession.endSession).toHaveBeenCalledTimes(1);
            expect(mockClient.close).toHaveBeenCalledTimes(1);
        });
    });
});
