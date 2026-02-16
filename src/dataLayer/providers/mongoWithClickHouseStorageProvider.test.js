const { describe, test, expect, beforeEach, jest } = require('@jest/globals');
const { MongoWithClickHouseStorageProvider } = require('./mongoWithClickHouseStorageProvider');
const { DatabaseCursor } = require('../databaseCursor');
const { STORAGE_PROVIDER_TYPES } = require('./storageProviderTypes');

describe('MongoWithClickHouseStorageProvider', () => {
    let provider;
    let mockResourceLocator;
    let mockClickHouseClientManager;
    let mockMongoStorageProvider;
    let mockConfigManager;

    beforeEach(() => {
        mockResourceLocator = {
            _resourceType: 'Group',
            _base_version: '4_0_0'
        };

        mockClickHouseClientManager = {
            queryAsync: jest.fn(),
            insertAsync: jest.fn()
        };

        mockMongoStorageProvider = {
            findAsync: jest.fn(),
            findOneAsync: jest.fn(),
            countAsync: jest.fn()
        };

        mockConfigManager = {
            clickHouseFallbackToMongo: false
        };

        provider = new MongoWithClickHouseStorageProvider({
            resourceLocator: mockResourceLocator,
            clickHouseClientManager: mockClickHouseClientManager,
            mongoStorageProvider: mockMongoStorageProvider,
            configManager: mockConfigManager
        });
    });

    describe('_isMemberQuery', () => {
        test.each([
            [{ 'member.entity._uuid': 'abc-123' }, true],
            [{ 'member.entity._sourceId': 'patient-1' }, true],
            [{ 'member.entity.reference': 'Patient/123' }, true],
            [{ member: 'Patient/123' }, true],
            [{ $and: [{ 'member.entity._uuid': 'abc' }] }, true],
            [{ $or: [{ 'member.entity.reference': 'Patient/1' }] }, true],
            [{ id: 'group-1' }, false],
            [{ name: 'Test Group' }, false],
            [{ type: 'person' }, false],
            [{ $and: [{ id: 'group-1' }, { name: 'test' }] }, false]
        ])('should detect member query: %p => %p', (query, expected) => {
            expect(provider._isMemberQuery(query)).toBe(expected);
        });
    });

    describe('_extractMemberCriteria', () => {
        test.each([
            [
                { 'member.entity._uuid': 'uuid-123' },
                { memberUuid: 'uuid-123', memberSourceId: null, memberReference: null }
            ],
            [
                { 'member.entity._sourceId': 'Patient/123' },
                { memberUuid: null, memberSourceId: 'Patient/123', memberReference: null }
            ],
            [
                { 'member.entity.reference': 'Patient/456' },
                { memberUuid: null, memberSourceId: null, memberReference: 'Patient/456' }
            ]
        ])('should extract criteria from %p', (query, expected) => {
            expect(provider._extractMemberCriteria(query)).toEqual(expected);
        });
    });

    describe('findAsync', () => {
        test('should route metadata queries to MongoDB', async () => {
            const query = { id: 'group-123', active: true };
            const mockCursor = {};
            mockMongoStorageProvider.findAsync.mockResolvedValue(mockCursor);

            const result = await provider.findAsync({ query, options: {}, extraInfo: {} });

            expect(mockMongoStorageProvider.findAsync).toHaveBeenCalled();
            expect(mockClickHouseClientManager.queryAsync).not.toHaveBeenCalled();
        });

        test('should route member queries to ClickHouse', async () => {
            const query = { 'member.entity.reference': 'Patient/123' };
            const mockCursor = {};

            mockClickHouseClientManager.queryAsync.mockResolvedValue([
                { group_id: 'group-1' },
                { group_id: 'group-2' }
            ]);
            mockMongoStorageProvider.findAsync.mockResolvedValue(mockCursor);

            await provider.findAsync({ query, options: {}, extraInfo: {} });

            expect(mockClickHouseClientManager.queryAsync).toHaveBeenCalled();
            expect(mockMongoStorageProvider.findAsync).toHaveBeenCalledWith({
                query: { id: { $in: ['group-1', 'group-2'] } },
                options: {},
                extraInfo: {}
            });
        });
    });

    describe('getStorageType', () => {
        test('should return "mongo-with-clickhouse"', () => {
            expect(provider.getStorageType()).toBe(STORAGE_PROVIDER_TYPES.MONGO_WITH_CLICKHOUSE);
        });
    });

    // Helper function tests removed - these methods were refactored into:
    // - GroupMemberEventBuilder (for event construction)
    // - SecurityTagExtractor (for tag extraction)

    describe('Edge Cases', () => {
        test('should handle MongoDB operator unwrapping in member queries', async () => {
            const query = {
                'member.entity.reference': {
                    $in: ['Patient/1', 'Patient/2']
                }
            };

            mockClickHouseClientManager.queryAsync.mockResolvedValue([
                { group_id: 'group-1' }
            ]);
            mockMongoStorageProvider.findAsync.mockResolvedValue({});

            await provider.findAsync({ query, options: {}, extraInfo: {} });

            expect(mockClickHouseClientManager.queryAsync).toHaveBeenCalled();
        });

        test('should fallback to MongoDB when no member criteria extracted', async () => {
            const query = { 'member.invalid': 'test' };
            mockMongoStorageProvider.findAsync.mockResolvedValue({});

            await provider.findAsync({ query, options: {}, extraInfo: {} });

            expect(mockMongoStorageProvider.findAsync).toHaveBeenCalled();
            expect(mockClickHouseClientManager.queryAsync).not.toHaveBeenCalled();
        });

        test('should pass limit option to ClickHouse queries', async () => {
            const query = { 'member.entity.reference': 'Patient/123' };
            const options = { limit: 50 };

            mockClickHouseClientManager.queryAsync
                .mockResolvedValueOnce([{ total: 1 }])  // count query
                .mockResolvedValueOnce([{ group_id: 'group-1' }]);  // page query
            mockMongoStorageProvider.findAsync.mockResolvedValue({});

            await provider.findAsync({ query, options, extraInfo: {} });

            expect(mockClickHouseClientManager.queryAsync).toHaveBeenCalledTimes(2);
            // Second call is the page query with limit
            const pageQueryCall = mockClickHouseClientManager.queryAsync.mock.calls[1][0];
            expect(pageQueryCall.query_params.limit).toBe(50);
        });

        test('should use default limit of 100 when not specified', async () => {
            const query = { 'member.entity.reference': 'Patient/123' };
            const options = {};

            mockClickHouseClientManager.queryAsync
                .mockResolvedValueOnce([{ total: 1 }])  // count query
                .mockResolvedValueOnce([{ group_id: 'group-1' }]);  // page query
            mockMongoStorageProvider.findAsync.mockResolvedValue({});

            await provider.findAsync({ query, options, extraInfo: {} });

            // Second call is the page query with default limit
            const pageQueryCall = mockClickHouseClientManager.queryAsync.mock.calls[1][0];
            expect(pageQueryCall.query_params.limit).toBe(100);
        });

        test('should handle nested $and/$or queries', async () => {
            const query = {
                $and: [
                    { 'member.entity.reference': 'Patient/123' },
                    { active: true }
                ]
            };

            mockClickHouseClientManager.queryAsync.mockResolvedValue([
                { group_id: 'group-1' }
            ]);
            mockMongoStorageProvider.findAsync.mockResolvedValue({});

            await provider.findAsync({ query, options: {}, extraInfo: {} });

            expect(mockClickHouseClientManager.queryAsync).toHaveBeenCalled();
        });

        test('should handle empty ClickHouse result set', async () => {
            const query = { 'member.entity.reference': 'Patient/nonexistent' };

            mockClickHouseClientManager.queryAsync.mockResolvedValue([]);
            mockMongoStorageProvider.findAsync.mockResolvedValue({});

            await provider.findAsync({ query, options: {}, extraInfo: {} });

            expect(mockMongoStorageProvider.findAsync).toHaveBeenCalledWith({
                query: { id: { $in: [] } },
                options: {},
                extraInfo: {}
            });
        });
    });

    describe('Error Handling', () => {
        test('should propagate ClickHouse query errors', async () => {
            const query = { 'member.entity.reference': 'Patient/123' };
            const error = new Error('ClickHouse connection failed');

            mockClickHouseClientManager.queryAsync.mockRejectedValue(error);

            await expect(
                provider.findAsync({ query, options: {}, extraInfo: {} })
            ).rejects.toThrow();
        });

        test('should propagate MongoDB query errors', async () => {
            const query = { id: 'group-1' };
            const error = new Error('MongoDB connection failed');

            mockMongoStorageProvider.findAsync.mockRejectedValue(error);

            await expect(
                provider.findAsync({ query, options: {}, extraInfo: {} })
            ).rejects.toThrow();
        });
    });

    describe('Constructor', () => {
        test('should initialize with required dependencies', () => {
            expect(provider.resourceLocator).toBe(mockResourceLocator);
            expect(provider.clickHouseClientManager).toBe(mockClickHouseClientManager);
            expect(provider.mongoStorageProvider).toBe(mockMongoStorageProvider);
            expect(provider.configManager).toBe(mockConfigManager);
        });
    });
});
