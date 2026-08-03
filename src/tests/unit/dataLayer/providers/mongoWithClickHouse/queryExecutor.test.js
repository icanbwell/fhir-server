'use strict';

const { describe, test, expect, jest: jestObj, beforeEach } = require('@jest/globals');

// Mock dependencies
jestObj.mock('../../../../../operations/common/logging', () => ({
    logInfo: jestObj.fn(),
    logError: jestObj.fn()
}));

const { QueryExecutor } = require('../../../../../dataLayer/providers/mongoWithClickHouse/queryExecutor');

describe('QueryExecutor', () => {
    let mockClickHouseManager;
    let mockMongoProvider;
    let queryDef;

    beforeEach(() => {
        jestObj.clearAllMocks();

        mockClickHouseManager = {
            queryAsync: jestObj.fn()
        };

        mockMongoProvider = {
            findAsync: jestObj.fn()
        };

        queryDef = {
            query: 'SELECT group_id FROM fhir.Group_4_0_0_MemberEvents WHERE ...',
            query_params: {
                memberReferenceUuid: 'uuid-123',
                memberReferenceSourceId: 'source-456'
            }
        };
    });

    describe('executeGroupMemberSearch', () => {
        test('calls ClickHouse query with queryDef', async () => {
            mockClickHouseManager.queryAsync.mockResolvedValue([]);
            mockMongoProvider.findAsync.mockResolvedValue({ toArray: () => [] });

            await QueryExecutor.executeGroupMemberSearch({
                clickHouseManager: mockClickHouseManager,
                mongoProvider: mockMongoProvider,
                queryDef,
                limit: 10,
                options: {},
                extraInfo: {}
            });

            expect(mockClickHouseManager.queryAsync).toHaveBeenCalledWith(queryDef);
        });

        test('returns empty result when ClickHouse returns no IDs', async () => {
            mockClickHouseManager.queryAsync.mockResolvedValue([]);
            const emptyResult = { _hasMore: false };
            mockMongoProvider.findAsync.mockResolvedValue(emptyResult);

            const result = await QueryExecutor.executeGroupMemberSearch({
                clickHouseManager: mockClickHouseManager,
                mongoProvider: mockMongoProvider,
                queryDef,
                limit: 10,
                options: { sort: [['id', 1]] },
                extraInfo: { collection: 'Group_4_0_0' }
            });

            // Should call findAsync with empty $in array
            expect(mockMongoProvider.findAsync).toHaveBeenCalledWith({
                query: { id: { $in: [] } },
                options: { sort: undefined, limit: undefined, skip: undefined },
                extraInfo: { collection: 'Group_4_0_0' }
            });
            expect(result).toBe(emptyResult);
        });

        test('fetches groups from MongoDB for found IDs', async () => {
            mockClickHouseManager.queryAsync.mockResolvedValue([
                { group_id: 'group-1' },
                { group_id: 'group-2' },
                { group_id: 'group-3' }
            ]);

            const mongoResult = { data: ['group1', 'group2', 'group3'] };
            mockMongoProvider.findAsync.mockResolvedValue(mongoResult);

            const result = await QueryExecutor.executeGroupMemberSearch({
                clickHouseManager: mockClickHouseManager,
                mongoProvider: mockMongoProvider,
                queryDef,
                limit: 10,
                options: { skip: 5, limit: 10 },
                extraInfo: { collection: 'Group_4_0_0' }
            });

            expect(mockMongoProvider.findAsync).toHaveBeenCalledWith({
                query: { id: { $in: ['group-1', 'group-2', 'group-3'] } },
                options: {
                    skip: undefined,
                    limit: 3,
                    sort: [['id', 1]]
                },
                extraInfo: { collection: 'Group_4_0_0' }
            });
            expect(result).toBe(mongoResult);
        });

        test('sets _hasMore flag when result count equals limit', async () => {
            mockClickHouseManager.queryAsync.mockResolvedValue([
                { group_id: 'group-1' },
                { group_id: 'group-2' }
            ]);

            const mongoResult = {};
            mockMongoProvider.findAsync.mockResolvedValue(mongoResult);

            const result = await QueryExecutor.executeGroupMemberSearch({
                clickHouseManager: mockClickHouseManager,
                mongoProvider: mockMongoProvider,
                queryDef,
                limit: 2,
                options: {},
                extraInfo: {}
            });

            expect(result._hasMore).toBe(true);
        });

        test('does not set _hasMore when result count is less than limit', async () => {
            mockClickHouseManager.queryAsync.mockResolvedValue([
                { group_id: 'group-1' }
            ]);

            const mongoResult = {};
            mockMongoProvider.findAsync.mockResolvedValue(mongoResult);

            const result = await QueryExecutor.executeGroupMemberSearch({
                clickHouseManager: mockClickHouseManager,
                mongoProvider: mockMongoProvider,
                queryDef,
                limit: 10,
                options: {},
                extraInfo: {}
            });

            expect(result._hasMore).toBeUndefined();
        });

        test('handles null result from ClickHouse', async () => {
            mockClickHouseManager.queryAsync.mockResolvedValue(null);
            const emptyResult = {};
            mockMongoProvider.findAsync.mockResolvedValue(emptyResult);

            const result = await QueryExecutor.executeGroupMemberSearch({
                clickHouseManager: mockClickHouseManager,
                mongoProvider: mockMongoProvider,
                queryDef,
                limit: 10,
                options: {},
                extraInfo: {}
            });

            // null maps to empty array, so should go through empty path
            expect(mockMongoProvider.findAsync).toHaveBeenCalledWith(
                expect.objectContaining({
                    query: { id: { $in: [] } }
                })
            );
        });

        test('throws error when ClickHouse query fails', async () => {
            const queryError = new Error('ClickHouse connection failed');
            mockClickHouseManager.queryAsync.mockRejectedValue(queryError);

            await expect(QueryExecutor.executeGroupMemberSearch({
                clickHouseManager: mockClickHouseManager,
                mongoProvider: mockMongoProvider,
                queryDef,
                limit: 10,
                options: {},
                extraInfo: {}
            })).rejects.toThrow('ClickHouse connection failed');
        });
    });
});
