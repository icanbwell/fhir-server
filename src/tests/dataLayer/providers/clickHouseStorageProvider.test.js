const { describe, test, beforeEach, expect, jest } = require('@jest/globals');
const { ClickHouseStorageProvider } = require('../../../dataLayer/providers/clickHouseStorageProvider');
const { ClickHouseDatabaseCursor } = require('../../../dataLayer/clickHouseDatabaseCursor');
const { STORAGE_PROVIDER_TYPES } = require('../../../dataLayer/providers/storageProviderTypes');

describe('ClickHouseStorageProvider', () => {
    let provider;
    let mockResourceLocator;
    let mockClickHouseClientManager;
    let mockConfigManager;

    const sampleRows = [
        { resource: { id: 'audit-1', resourceType: 'AuditEvent', action: 'R' }, _uuid: 'uuid-1' },
        { resource: { id: 'audit-2', resourceType: 'AuditEvent', action: 'U' }, _uuid: 'uuid-2' }
    ];

    beforeEach(() => {
        mockResourceLocator = {
            _resourceType: 'AuditEvent',
            _base_version: '4_0_0'
        };

        mockClickHouseClientManager = {
            queryAsync: jest.fn().mockResolvedValue(sampleRows)
        };

        mockConfigManager = {
            enableClickHouse: true
        };

        provider = new ClickHouseStorageProvider({
            resourceLocator: mockResourceLocator,
            clickHouseClientManager: mockClickHouseClientManager,
            configManager: mockConfigManager
        });
    });

    describe('getStorageType', () => {
        test('returns CLICKHOUSE storage type', () => {
            expect(provider.getStorageType()).toBe(STORAGE_PROVIDER_TYPES.CLICKHOUSE);
        });
    });

    describe('findAsync', () => {
        test('returns ClickHouseDatabaseCursor', async () => {
            const cursor = await provider.findAsync({
                query: { action: 'R' },
                options: {}
            });

            expect(cursor).toBeInstanceOf(ClickHouseDatabaseCursor);
        });

        test('passes translated SQL to queryAsync', async () => {
            await provider.findAsync({
                query: { action: 'R' },
                options: {}
            });

            expect(mockClickHouseClientManager.queryAsync).toHaveBeenCalledTimes(1);
            const callArgs = mockClickHouseClientManager.queryAsync.mock.calls[0][0];
            expect(callArgs.query).toContain('SELECT resource, _uuid FROM');
            expect(callArgs.query).toContain('action =');
            expect(callArgs.query_params).toBeDefined();
        });

        test('cursor contains results from queryAsync', async () => {
            const cursor = await provider.findAsync({
                query: {},
                options: {}
            });

            expect(await cursor.hasNext()).toBe(true);
            const doc = await cursor.next();
            expect(doc.id).toBe('audit-1');
        });

        test('passes sort and limit options to translator', async () => {
            await provider.findAsync({
                query: {},
                options: { sort: { recorded: -1 }, limit: 10, skip: 5 }
            });

            const callArgs = mockClickHouseClientManager.queryAsync.mock.calls[0][0];
            expect(callArgs.query).toContain('ORDER BY recorded DESC');
            expect(callArgs.query).toContain('LIMIT {limit:UInt32}');
            expect(callArgs.query).toContain('OFFSET {skip:UInt32}');
            expect(callArgs.query_params.limit).toBe(10);
            expect(callArgs.query_params.skip).toBe(5);
        });
    });

    describe('findOneAsync', () => {
        test('returns resource for single result', async () => {
            mockClickHouseClientManager.queryAsync.mockResolvedValue([sampleRows[0]]);

            const result = await provider.findOneAsync({
                query: { id: 'audit-1' }
            });

            expect(result).toBeDefined();
            expect(result.id).toBe('audit-1');
        });

        test('returns null for no results', async () => {
            mockClickHouseClientManager.queryAsync.mockResolvedValue([]);

            const result = await provider.findOneAsync({
                query: { id: 'nonexistent' }
            });

            expect(result).toBeNull();
        });

        test('adds LIMIT 1 to query', async () => {
            await provider.findOneAsync({
                query: { id: 'audit-1' }
            });

            const callArgs = mockClickHouseClientManager.queryAsync.mock.calls[0][0];
            expect(callArgs.query).toContain('LIMIT {limit:UInt32}');
            expect(callArgs.query_params.limit).toBe(1);
        });
    });

    describe('countAsync', () => {
        test('returns count', async () => {
            mockClickHouseClientManager.queryAsync.mockResolvedValue([{ cnt: '42' }]);

            const count = await provider.countAsync({
                query: { action: 'R' }
            });

            expect(count).toBe(42);
        });

        test('returns 0 for empty result', async () => {
            mockClickHouseClientManager.queryAsync.mockResolvedValue([]);

            const count = await provider.countAsync({
                query: {}
            });

            expect(count).toBe(0);
        });

        test('uses count() SQL', async () => {
            await provider.countAsync({
                query: { action: 'R' }
            });

            const callArgs = mockClickHouseClientManager.queryAsync.mock.calls[0][0];
            expect(callArgs.query).toContain('SELECT count() AS cnt');
        });
    });

    describe('upsertAsync', () => {
        test('throws error', async () => {
            await expect(
                provider.upsertAsync({ resources: [], options: {} })
            ).rejects.toThrow('ClickHouseStorageProvider.upsertAsync not supported');
        });
    });
});
