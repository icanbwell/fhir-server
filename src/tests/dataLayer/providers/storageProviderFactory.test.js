const { describe, test, expect, beforeEach, jest } = require('@jest/globals');
const { StorageProviderFactory } = require('../../../dataLayer/providers/storageProviderFactory');
const { MongoStorageProvider } = require('../../../dataLayer/providers/mongoStorageProvider');
const { ClickHouseStorageProvider } = require('../../../dataLayer/providers/clickHouseStorageProvider');
const { STORAGE_PROVIDER_TYPES } = require('../../../dataLayer/providers/storageProviderTypes');

describe('StorageProviderFactory - AuditEvent routing', () => {
    let mockResourceLocatorFactory;
    let mockClickHouseClientManager;
    let mockDatabaseAttachmentManager;
    let mockConfigManager;

    beforeEach(() => {
        mockResourceLocatorFactory = {
            createResourceLocator: jest.fn().mockReturnValue({
                _resourceType: 'Test',
                _base_version: '4_0_0'
            })
        };

        mockClickHouseClientManager = {
            queryAsync: jest.fn(),
            insertAsync: jest.fn()
        };

        mockDatabaseAttachmentManager = {};

        mockConfigManager = {
            enableClickHouse: true,
            clickHouseEnabledResources: [],
            mongoWithClickHouseResources: [],
            clickHouseOnlyResources: [],
            clickHouseEnableAuditEventRead: false
        };
    });

    test('AuditEvent routes to ClickHouse when flag is on', () => {
        mockConfigManager.clickHouseEnableAuditEventRead = true;

        const factory = new StorageProviderFactory({
            resourceLocatorFactory: mockResourceLocatorFactory,
            clickHouseClientManager: mockClickHouseClientManager,
            databaseAttachmentManager: mockDatabaseAttachmentManager,
            configManager: mockConfigManager
        });

        const provider = factory.createProvider({
            resourceType: 'AuditEvent',
            base_version: '4_0_0'
        });

        expect(provider).toBeInstanceOf(ClickHouseStorageProvider);
        expect(provider.getStorageType()).toBe(STORAGE_PROVIDER_TYPES.CLICKHOUSE);
    });

    test('AuditEvent routes to Mongo when flag is off', () => {
        mockConfigManager.clickHouseEnableAuditEventRead = false;

        const factory = new StorageProviderFactory({
            resourceLocatorFactory: mockResourceLocatorFactory,
            clickHouseClientManager: mockClickHouseClientManager,
            databaseAttachmentManager: mockDatabaseAttachmentManager,
            configManager: mockConfigManager
        });

        const provider = factory.createProvider({
            resourceType: 'AuditEvent',
            base_version: '4_0_0'
        });

        expect(provider).toBeInstanceOf(MongoStorageProvider);
        expect(provider.getStorageType()).toBe(STORAGE_PROVIDER_TYPES.MONGO);
    });

    test('AuditEvent routes to Mongo when ClickHouse is disabled globally', () => {
        mockConfigManager.enableClickHouse = false;
        mockConfigManager.clickHouseEnableAuditEventRead = true;

        const factory = new StorageProviderFactory({
            resourceLocatorFactory: mockResourceLocatorFactory,
            clickHouseClientManager: mockClickHouseClientManager,
            databaseAttachmentManager: mockDatabaseAttachmentManager,
            configManager: mockConfigManager
        });

        const provider = factory.createProvider({
            resourceType: 'AuditEvent',
            base_version: '4_0_0'
        });

        expect(provider).toBeInstanceOf(MongoStorageProvider);
        expect(provider.getStorageType()).toBe(STORAGE_PROVIDER_TYPES.MONGO);
    });

    test('non-AuditEvent unaffected by clickHouseEnableAuditEventRead flag', () => {
        mockConfigManager.clickHouseEnableAuditEventRead = true;

        const factory = new StorageProviderFactory({
            resourceLocatorFactory: mockResourceLocatorFactory,
            clickHouseClientManager: mockClickHouseClientManager,
            databaseAttachmentManager: mockDatabaseAttachmentManager,
            configManager: mockConfigManager
        });

        const provider = factory.createProvider({
            resourceType: 'Patient',
            base_version: '4_0_0'
        });

        expect(provider).toBeInstanceOf(MongoStorageProvider);
        expect(provider.getStorageType()).toBe(STORAGE_PROVIDER_TYPES.MONGO);
    });

    test('getStorageTypeForResource returns clickhouse for AuditEvent when flag on', () => {
        mockConfigManager.clickHouseEnableAuditEventRead = true;

        const factory = new StorageProviderFactory({
            resourceLocatorFactory: mockResourceLocatorFactory,
            clickHouseClientManager: mockClickHouseClientManager,
            databaseAttachmentManager: mockDatabaseAttachmentManager,
            configManager: mockConfigManager
        });

        expect(factory.getStorageTypeForResource('AuditEvent')).toBe(STORAGE_PROVIDER_TYPES.CLICKHOUSE);
    });

    test('AuditEvent routes to Mongo when clickHouseClientManager is null', () => {
        mockConfigManager.clickHouseEnableAuditEventRead = true;

        const factory = new StorageProviderFactory({
            resourceLocatorFactory: mockResourceLocatorFactory,
            clickHouseClientManager: null,
            databaseAttachmentManager: mockDatabaseAttachmentManager,
            configManager: mockConfigManager
        });

        const provider = factory.createProvider({
            resourceType: 'AuditEvent',
            base_version: '4_0_0'
        });

        expect(provider).toBeInstanceOf(MongoStorageProvider);
    });
});
