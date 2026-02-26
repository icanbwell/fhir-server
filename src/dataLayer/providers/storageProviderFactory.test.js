const { describe, test, expect, beforeEach, jest } = require('@jest/globals');
const { StorageProviderFactory } = require('./storageProviderFactory');
const { MongoStorageProvider } = require('./mongoStorageProvider');
const { MongoWithClickHouseStorageProvider } = require('./mongoWithClickHouseStorageProvider');
const { ClickHouseStorageProvider } = require('./clickHouseStorageProvider');
const { STORAGE_PROVIDER_TYPES } = require('./storageProviderTypes');

describe('StorageProviderFactory', () => {
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
            enableClickHouse: false,
            clickHouseEnabledResources: [],
            mongoWithClickHouseResources: [],
            clickHouseOnlyResources: []
        };
    });

    describe('when ClickHouse is disabled', () => {
        test('should create MongoStorageProvider for all resources', () => {
            const factory = new StorageProviderFactory({
                resourceLocatorFactory: mockResourceLocatorFactory,
                clickHouseClientManager: mockClickHouseClientManager,
                databaseAttachmentManager: mockDatabaseAttachmentManager,
                configManager: mockConfigManager
            });

            const provider = factory.createProvider({
                resourceType: 'Group',
                base_version: '4_0_0'
            });

            expect(provider).toBeInstanceOf(MongoStorageProvider);
            expect(provider.getStorageType()).toBe(STORAGE_PROVIDER_TYPES.MONGO);
        });

        test.each([
            ['Patient'],
            ['Observation'],
            ['Group'],
            ['Practitioner']
        ])('should use MongoDB for %s resource type', (resourceType) => {
            const factory = new StorageProviderFactory({
                resourceLocatorFactory: mockResourceLocatorFactory,
                clickHouseClientManager: mockClickHouseClientManager,
                databaseAttachmentManager: mockDatabaseAttachmentManager,
                configManager: mockConfigManager
            });

            expect(factory.getStorageTypeForResource(resourceType)).toBe(STORAGE_PROVIDER_TYPES.MONGO);
        });
    });

    describe('when ClickHouse is enabled', () => {
        beforeEach(() => {
            mockConfigManager.enableClickHouse = true;
            mockConfigManager.clickHouseEnabledResources = ['Group'];
            mockConfigManager.mongoWithClickHouseResources = ['Group'];
        });

        test('should create MongoWithClickHouseStorageProvider for Group resource', () => {
            const factory = new StorageProviderFactory({
                resourceLocatorFactory: mockResourceLocatorFactory,
                clickHouseClientManager: mockClickHouseClientManager,
                databaseAttachmentManager: mockDatabaseAttachmentManager,
                configManager: mockConfigManager
            });

            const provider = factory.createProvider({
                resourceType: 'Group',
                base_version: '4_0_0'
            });

            expect(provider).toBeInstanceOf(MongoWithClickHouseStorageProvider);
            expect(provider.getStorageType()).toBe(STORAGE_PROVIDER_TYPES.MONGO_WITH_CLICKHOUSE);
        });

        test('should create MongoStorageProvider for non-enabled resources', () => {
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

        test.each([
            ['Group', 'mongo-with-clickhouse'],
            ['Patient', 'mongo'],
            ['Observation', 'mongo'],
            ['Practitioner', 'mongo']
        ])('should use %s storage for %s resource', (resourceType, expectedStorage) => {
            const factory = new StorageProviderFactory({
                resourceLocatorFactory: mockResourceLocatorFactory,
                clickHouseClientManager: mockClickHouseClientManager,
                databaseAttachmentManager: mockDatabaseAttachmentManager,
                configManager: mockConfigManager
            });

            expect(factory.getStorageTypeForResource(resourceType)).toBe(expectedStorage);
        });
    });

    describe('when ClickHouse client is unavailable', () => {
        test('should fallback to MongoDB even if enabled in config', () => {
            mockConfigManager.enableClickHouse = true;
            mockConfigManager.clickHouseEnabledResources = ['Group'];

            const factory = new StorageProviderFactory({
                resourceLocatorFactory: mockResourceLocatorFactory,
                clickHouseClientManager: null,
                databaseAttachmentManager: mockDatabaseAttachmentManager,
                configManager: mockConfigManager
            });

            const provider = factory.createProvider({
                resourceType: 'Group',
                base_version: '4_0_0'
            });

            expect(provider).toBeInstanceOf(MongoStorageProvider);
            expect(factory.isClickHouseAvailable()).toBe(false);
        });
    });

    describe('helper methods', () => {
        test('isClickHouseAvailable should return correct status', () => {
            const factory = new StorageProviderFactory({
                resourceLocatorFactory: mockResourceLocatorFactory,
                clickHouseClientManager: mockClickHouseClientManager,
                databaseAttachmentManager: mockDatabaseAttachmentManager,
                configManager: mockConfigManager
            });

            expect(factory.isClickHouseAvailable()).toBe(false);

            mockConfigManager.enableClickHouse = true;
            const factory2 = new StorageProviderFactory({
                resourceLocatorFactory: mockResourceLocatorFactory,
                clickHouseClientManager: mockClickHouseClientManager,
                databaseAttachmentManager: mockDatabaseAttachmentManager,
                configManager: mockConfigManager
            });

            expect(factory2.isClickHouseAvailable()).toBe(true);
        });

        test('getClickHouseEnabledResources should return enabled list', () => {
            mockConfigManager.enableClickHouse = true;
            mockConfigManager.mongoWithClickHouseResources = ['Group'];
            mockConfigManager.clickHouseOnlyResources = ['Patient'];

            const factory = new StorageProviderFactory({
                resourceLocatorFactory: mockResourceLocatorFactory,
                clickHouseClientManager: mockClickHouseClientManager,
                databaseAttachmentManager: mockDatabaseAttachmentManager,
                configManager: mockConfigManager
            });

            expect(factory.getClickHouseEnabledResources()).toEqual(['Group', 'Patient']);
        });
    });

    describe('Storage Provider Type Mapping', () => {
        beforeEach(() => {
            mockConfigManager.enableClickHouse = true;
            mockConfigManager.clickHouseEnabledResources = ['Group'];
            mockConfigManager.mongoWithClickHouseResources = ['Group'];
        });

        test('should create correct provider type based on mapping', () => {
            const factory = new StorageProviderFactory({
                resourceLocatorFactory: mockResourceLocatorFactory,
                clickHouseClientManager: mockClickHouseClientManager,
                databaseAttachmentManager: mockDatabaseAttachmentManager,
                configManager: mockConfigManager
            });

            // Test mongo-with-clickhouse provider for Group
            const groupProvider = factory.createProvider({
                resourceType: 'Group',
                base_version: '4_0_0'
            });
            expect(groupProvider).toBeInstanceOf(MongoWithClickHouseStorageProvider);
            expect(groupProvider.getStorageType()).toBe(STORAGE_PROVIDER_TYPES.MONGO_WITH_CLICKHOUSE);

            // Test mongo provider for unmapped resources
            const patientProvider = factory.createProvider({
                resourceType: 'Patient',
                base_version: '4_0_0'
            });
            expect(patientProvider).toBeInstanceOf(MongoStorageProvider);
            expect(patientProvider.getStorageType()).toBe(STORAGE_PROVIDER_TYPES.MONGO);
        });

        test('should return correct storage type from getStorageTypeForResource', () => {
            const factory = new StorageProviderFactory({
                resourceLocatorFactory: mockResourceLocatorFactory,
                clickHouseClientManager: mockClickHouseClientManager,
                databaseAttachmentManager: mockDatabaseAttachmentManager,
                configManager: mockConfigManager
            });

            expect(factory.getStorageTypeForResource('Group')).toBe(STORAGE_PROVIDER_TYPES.MONGO_WITH_CLICKHOUSE);
            expect(factory.getStorageTypeForResource('Patient')).toBe(STORAGE_PROVIDER_TYPES.MONGO);
            expect(factory.getStorageTypeForResource('Observation')).toBe(STORAGE_PROVIDER_TYPES.MONGO);
            expect(factory.getStorageTypeForResource('UnknownResource')).toBe(STORAGE_PROVIDER_TYPES.MONGO);
        });

        test('should handle missing storageProviderMap gracefully', () => {
            const factory = new StorageProviderFactory({
                resourceLocatorFactory: mockResourceLocatorFactory,
                clickHouseClientManager: mockClickHouseClientManager,
                databaseAttachmentManager: mockDatabaseAttachmentManager,
                configManager: mockConfigManager
            });

            // Resource not in map should default to mongo
            const provider = factory.createProvider({
                resourceType: 'NewResource',
                base_version: '4_0_0'
            });

            expect(provider).toBeInstanceOf(MongoStorageProvider);
        });

        test('should use mongo when ClickHouse disabled even if resource in map', () => {
            mockConfigManager.enableClickHouse = false;

            const factory = new StorageProviderFactory({
                resourceLocatorFactory: mockResourceLocatorFactory,
                clickHouseClientManager: mockClickHouseClientManager,
                databaseAttachmentManager: mockDatabaseAttachmentManager,
                configManager: mockConfigManager
            });

            // Group is in map as 'mongo-with-clickhouse' but should get mongo because CH disabled
            const provider = factory.createProvider({
                resourceType: 'Group',
                base_version: '4_0_0'
            });

            expect(provider).toBeInstanceOf(MongoStorageProvider);
            expect(factory.getStorageTypeForResource('Group')).toBe(STORAGE_PROVIDER_TYPES.MONGO);
        });
    });

    describe('Provider Instantiation', () => {
        test('should create providers with correct dependencies', () => {
            mockConfigManager.enableClickHouse = true;
            mockConfigManager.mongoWithClickHouseResources = ['Group'];

            const factory = new StorageProviderFactory({
                resourceLocatorFactory: mockResourceLocatorFactory,
                clickHouseClientManager: mockClickHouseClientManager,
                databaseAttachmentManager: mockDatabaseAttachmentManager,
                configManager: mockConfigManager
            });

            const mongoWithClickHouseProvider = factory.createProvider({
                resourceType: 'Group',
                base_version: '4_0_0'
            });

            expect(mongoWithClickHouseProvider.clickHouseClientManager).toBe(mockClickHouseClientManager);
            expect(mongoWithClickHouseProvider.mongoStorageProvider).toBeInstanceOf(MongoStorageProvider);
            expect(mongoWithClickHouseProvider.configManager).toBe(mockConfigManager);
        });

        test('should create ResourceLocator for each provider', () => {
            const factory = new StorageProviderFactory({
                resourceLocatorFactory: mockResourceLocatorFactory,
                clickHouseClientManager: mockClickHouseClientManager,
                databaseAttachmentManager: mockDatabaseAttachmentManager,
                configManager: mockConfigManager
            });

            factory.createProvider({
                resourceType: 'Patient',
                base_version: '4_0_0'
            });

            expect(mockResourceLocatorFactory.createResourceLocator).toHaveBeenCalledWith({
                resourceType: 'Patient',
                base_version: '4_0_0'
            });
        });
    });

    describe('Future-proofing for ClickHouseStorageProvider', () => {
        test('should be able to add clickhouse-only provider type via configuration', () => {
            mockConfigManager.enableClickHouse = true;
            mockConfigManager.clickHouseOnlyResources = ['FHIRAuditEvent'];

            const factory = new StorageProviderFactory({
                resourceLocatorFactory: mockResourceLocatorFactory,
                clickHouseClientManager: mockClickHouseClientManager,
                databaseAttachmentManager: mockDatabaseAttachmentManager,
                configManager: mockConfigManager
            });

            const provider = factory.createProvider({
                resourceType: 'FHIRAuditEvent',
                base_version: '4_0_0'
            });

            expect(provider).toBeInstanceOf(ClickHouseStorageProvider);
            expect(provider.getStorageType()).toBe(STORAGE_PROVIDER_TYPES.CLICKHOUSE);
        });

        test('should return clickhouse from getStorageTypeForResource when configured', () => {
            mockConfigManager.enableClickHouse = true;
            mockConfigManager.clickHouseOnlyResources = ['FHIRAuditEvent'];

            const factory = new StorageProviderFactory({
                resourceLocatorFactory: mockResourceLocatorFactory,
                clickHouseClientManager: mockClickHouseClientManager,
                databaseAttachmentManager: mockDatabaseAttachmentManager,
                configManager: mockConfigManager
            });

            expect(factory.getStorageTypeForResource('FHIRAuditEvent')).toBe(STORAGE_PROVIDER_TYPES.CLICKHOUSE);
        });
    });
});
