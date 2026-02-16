const { ClickHouseStorageProvider } = require('./clickHouseStorageProvider');
const { STORAGE_PROVIDER_TYPES } = require('./storageProviderTypes');

describe('ClickHouseStorageProvider', () => {
    let provider;
    let mockResourceLocator;
    let mockClickHouseClientManager;
    let mockConfigManager;

    beforeEach(() => {
        mockResourceLocator = {
            resourceType: 'AuditEvent',
            base_version: '4_0_0'
        };

        mockClickHouseClientManager = {
            query: jest.fn()
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

    describe('stub methods', () => {
        test('findAsync throws not implemented error', async () => {
            await expect(
                provider.findAsync({ query: {}, options: {} })
            ).rejects.toThrow('ClickHouseStorageProvider.findAsync not yet implemented');
        });

        test('findOneAsync throws not implemented error', async () => {
            await expect(
                provider.findOneAsync({ query: {} })
            ).rejects.toThrow('ClickHouseStorageProvider.findOneAsync not yet implemented');
        });

        test('countAsync throws not implemented error', async () => {
            await expect(
                provider.countAsync({ query: {} })
            ).rejects.toThrow('ClickHouseStorageProvider.countAsync not yet implemented');
        });

        test('upsertAsync throws not implemented error', async () => {
            await expect(
                provider.upsertAsync({ resources: [], options: {} })
            ).rejects.toThrow('ClickHouseStorageProvider.upsertAsync not yet implemented');
        });
    });
});
