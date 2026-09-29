'use strict';

const { describe, test, expect, beforeEach, jest: jestObj } = require('@jest/globals');

// Mock assertType to avoid real type checking in unit tests
jestObj.mock('../../../utils/assertType', () => ({
    assertTypeEquals: jestObj.fn(),
    assertIsValid: jestObj.fn()
}));

// Mock DatabaseQueryManager
jestObj.mock('../../../dataLayer/databaseQueryManager', () => ({
    DatabaseQueryManager: jestObj.fn().mockImplementation((params) => ({
        resourceLocatorFactory: params.resourceLocatorFactory,
        storageProvider: params.storageProvider,
        _resourceType: params.resourceType,
        _base_version: params.base_version,
        _isDatabaseQueryManager: true
    }))
}));

const { DatabaseQueryFactory } = require('../../../dataLayer/databaseQueryFactory');
const { DatabaseQueryManager } = require('../../../dataLayer/databaseQueryManager');
const { ResourceLocatorFactory } = require('../../../operations/common/resourceLocatorFactory');
const { assertTypeEquals, assertIsValid } = require('../../../utils/assertType');

describe('DatabaseQueryFactory', () => {
    let mockResourceLocatorFactory;
    let mockStorageProviderFactory;
    let mockStorageProvider;

    beforeEach(() => {
        jestObj.clearAllMocks();

        mockResourceLocatorFactory = Object.create(ResourceLocatorFactory.prototype);
        mockResourceLocatorFactory.createResourceLocator = jestObj.fn();

        mockStorageProvider = {
            findAsync: jestObj.fn(),
            findOneAsync: jestObj.fn(),
            getStorageType: jestObj.fn().mockReturnValue('mongodb')
        };

        mockStorageProviderFactory = {
            createProvider: jestObj.fn().mockReturnValue(mockStorageProvider)
        };
    });

    describe('constructor', () => {
        test('should store resourceLocatorFactory', () => {
            const factory = new DatabaseQueryFactory({
                resourceLocatorFactory: mockResourceLocatorFactory,
                storageProviderFactory: mockStorageProviderFactory
            });

            expect(factory.resourceLocatorFactory).toBe(mockResourceLocatorFactory);
        });

        test('should store storageProviderFactory when provided', () => {
            const factory = new DatabaseQueryFactory({
                resourceLocatorFactory: mockResourceLocatorFactory,
                storageProviderFactory: mockStorageProviderFactory
            });

            expect(factory.storageProviderFactory).toBe(mockStorageProviderFactory);
        });

        test('should set storageProviderFactory to null when not provided', () => {
            const factory = new DatabaseQueryFactory({
                resourceLocatorFactory: mockResourceLocatorFactory
            });

            expect(factory.storageProviderFactory).toBeNull();
        });

        test('should call assertTypeEquals with resourceLocatorFactory', () => {
            new DatabaseQueryFactory({
                resourceLocatorFactory: mockResourceLocatorFactory,
                storageProviderFactory: mockStorageProviderFactory
            });

            expect(assertTypeEquals).toHaveBeenCalledWith(
                mockResourceLocatorFactory,
                ResourceLocatorFactory
            );
        });
    });

    describe('createQuery', () => {
        describe('with storageProviderFactory', () => {
            let factory;

            beforeEach(() => {
                factory = new DatabaseQueryFactory({
                    resourceLocatorFactory: mockResourceLocatorFactory,
                    storageProviderFactory: mockStorageProviderFactory
                });
            });

            test('should create DatabaseQueryManager with correct params', () => {
                const result = factory.createQuery({
                    resourceType: 'Patient',
                    base_version: '4_0_0'
                });

                expect(DatabaseQueryManager).toHaveBeenCalledWith({
                    resourceLocatorFactory: mockResourceLocatorFactory,
                    storageProvider: mockStorageProvider,
                    resourceType: 'Patient',
                    base_version: '4_0_0'
                });
                expect(result._isDatabaseQueryManager).toBe(true);
            });

            test('should call assertIsValid with resourceType', () => {
                factory.createQuery({
                    resourceType: 'Patient',
                    base_version: '4_0_0'
                });

                expect(assertIsValid).toHaveBeenCalledWith('Patient', 'resourceType is null');
            });

            test('should call storageProviderFactory.createProvider with correct params', () => {
                factory.createQuery({
                    resourceType: 'Observation',
                    base_version: '4_0_0'
                });

                expect(mockStorageProviderFactory.createProvider).toHaveBeenCalledWith({
                    resourceType: 'Observation',
                    base_version: '4_0_0'
                });
            });

            test('should pass the storage provider from factory to the manager', () => {
                const customStorageProvider = { custom: true };
                mockStorageProviderFactory.createProvider.mockReturnValue(customStorageProvider);

                factory.createQuery({
                    resourceType: 'Patient',
                    base_version: '4_0_0'
                });

                expect(DatabaseQueryManager).toHaveBeenCalledWith(
                    expect.objectContaining({
                        storageProvider: customStorageProvider
                    })
                );
            });

            test('should pass different resource types correctly', () => {
                factory.createQuery({
                    resourceType: 'Encounter',
                    base_version: '4_0_0'
                });

                expect(mockStorageProviderFactory.createProvider).toHaveBeenCalledWith({
                    resourceType: 'Encounter',
                    base_version: '4_0_0'
                });

                expect(DatabaseQueryManager).toHaveBeenCalledWith(
                    expect.objectContaining({
                        resourceType: 'Encounter',
                        base_version: '4_0_0'
                    })
                );
            });
        });

        describe('without storageProviderFactory', () => {
            let factory;

            beforeEach(() => {
                factory = new DatabaseQueryFactory({
                    resourceLocatorFactory: mockResourceLocatorFactory
                });
            });

            test('should create DatabaseQueryManager with null storageProvider', () => {
                factory.createQuery({
                    resourceType: 'Patient',
                    base_version: '4_0_0'
                });

                expect(DatabaseQueryManager).toHaveBeenCalledWith({
                    resourceLocatorFactory: mockResourceLocatorFactory,
                    storageProvider: null,
                    resourceType: 'Patient',
                    base_version: '4_0_0'
                });
            });

            test('should not call createProvider', () => {
                factory.createQuery({
                    resourceType: 'Patient',
                    base_version: '4_0_0'
                });

                expect(mockStorageProviderFactory.createProvider).not.toHaveBeenCalled();
            });
        });

        test('should return a new instance each time', () => {
            const factory = new DatabaseQueryFactory({
                resourceLocatorFactory: mockResourceLocatorFactory,
                storageProviderFactory: mockStorageProviderFactory
            });

            const result1 = factory.createQuery({
                resourceType: 'Patient',
                base_version: '4_0_0'
            });

            const result2 = factory.createQuery({
                resourceType: 'Patient',
                base_version: '4_0_0'
            });

            expect(result1).not.toBe(result2);
        });

        test('should pass different base_version values', () => {
            const factory = new DatabaseQueryFactory({
                resourceLocatorFactory: mockResourceLocatorFactory,
                storageProviderFactory: mockStorageProviderFactory
            });

            factory.createQuery({
                resourceType: 'Patient',
                base_version: '3_0_1'
            });

            expect(DatabaseQueryManager).toHaveBeenCalledWith(
                expect.objectContaining({
                    base_version: '3_0_1'
                })
            );
        });
    });
});
