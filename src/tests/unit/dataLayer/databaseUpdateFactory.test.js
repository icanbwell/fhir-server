'use strict';

const { describe, test, expect, beforeEach, jest: jestObj } = require('@jest/globals');

// Mock assertType to avoid real type checking in unit tests
jestObj.mock('../../../utils/assertType', () => ({
    assertTypeEquals: jestObj.fn(),
    assertIsValid: jestObj.fn()
}));

// Mock DatabaseUpdateManager
jestObj.mock('../../../dataLayer/databaseUpdateManager', () => ({
    DatabaseUpdateManager: jestObj.fn().mockImplementation((params) => ({
        _resourceType: params.resourceType,
        _base_version: params.base_version,
        resourceLocatorFactory: params.resourceLocatorFactory,
        resourceMerger: params.resourceMerger,
        preSaveManager: params.preSaveManager,
        databaseQueryFactory: params.databaseQueryFactory,
        configManager: params.configManager,
        base64DataManager: params.base64DataManager,
        _isDatabaseUpdateManager: true
    }))
}));

// Mock FastDatabaseUpdateManager
jestObj.mock('../../../dataLayer/fastDatabaseUpdateManager', () => ({
    FastDatabaseUpdateManager: jestObj.fn().mockImplementation((params) => ({
        _resourceType: params.resourceType,
        _base_version: params.base_version,
        resourceLocatorFactory: params.resourceLocatorFactory,
        resourceMerger: params.resourceMerger,
        preSaveManager: params.preSaveManager,
        databaseQueryFactory: params.databaseQueryFactory,
        configManager: params.configManager,
        base64DataManager: params.base64DataManager,
        _isFastDatabaseUpdateManager: true
    }))
}));

const { DatabaseUpdateFactory } = require('../../../dataLayer/databaseUpdateFactory');
const { DatabaseUpdateManager } = require('../../../dataLayer/databaseUpdateManager');
const { FastDatabaseUpdateManager } = require('../../../dataLayer/fastDatabaseUpdateManager');
const { ResourceLocatorFactory } = require('../../../operations/common/resourceLocatorFactory');
const { ResourceMerger } = require('../../../operations/common/resourceMerger');
const { PreSaveManager } = require('../../../preSaveHandlers/preSave');
const { DatabaseQueryFactory } = require('../../../dataLayer/databaseQueryFactory');
const { ConfigManager } = require('../../../utils/configManager');
const { Base64DataManager } = require('../../../dataLayer/base64DataManager');
const { assertTypeEquals } = require('../../../utils/assertType');

describe('DatabaseUpdateFactory', () => {
    let mockResourceLocatorFactory;
    let mockResourceMerger;
    let mockPreSaveManager;
    let mockDatabaseQueryFactory;
    let mockConfigManager;
    let mockBase64DataManager;

    beforeEach(() => {
        jestObj.clearAllMocks();

        mockResourceLocatorFactory = Object.create(ResourceLocatorFactory.prototype);
        mockResourceLocatorFactory.createResourceLocator = jestObj.fn();

        mockResourceMerger = Object.create(ResourceMerger.prototype);
        mockResourceMerger.mergeResourceAsync = jestObj.fn();

        mockPreSaveManager = Object.create(PreSaveManager.prototype);
        mockPreSaveManager.preSaveAsync = jestObj.fn();

        mockDatabaseQueryFactory = Object.create(DatabaseQueryFactory.prototype);
        mockDatabaseQueryFactory.createQuery = jestObj.fn();

        mockConfigManager = Object.create(ConfigManager.prototype);

        mockBase64DataManager = Object.create(Base64DataManager.prototype);
    });

    function createFactory(overrides = {}) {
        return new DatabaseUpdateFactory({
            resourceLocatorFactory: overrides.resourceLocatorFactory || mockResourceLocatorFactory,
            resourceMerger: overrides.resourceMerger || mockResourceMerger,
            preSaveManager: overrides.preSaveManager || mockPreSaveManager,
            databaseQueryFactory: overrides.databaseQueryFactory || mockDatabaseQueryFactory,
            configManager: overrides.configManager || mockConfigManager,
            base64DataManager: overrides.base64DataManager || mockBase64DataManager
        });
    }

    describe('constructor', () => {
        test('should store all dependencies', () => {
            const factory = createFactory();

            expect(factory.resourceLocatorFactory).toBe(mockResourceLocatorFactory);
            expect(factory.resourceMerger).toBe(mockResourceMerger);
            expect(factory.preSaveManager).toBe(mockPreSaveManager);
            expect(factory.databaseQueryFactory).toBe(mockDatabaseQueryFactory);
            expect(factory.configManager).toBe(mockConfigManager);
            expect(factory.base64DataManager).toBe(mockBase64DataManager);
        });

        test('should call assertTypeEquals for all typed dependencies', () => {
            createFactory();

            expect(assertTypeEquals).toHaveBeenCalledWith(mockResourceLocatorFactory, ResourceLocatorFactory);
            expect(assertTypeEquals).toHaveBeenCalledWith(mockResourceMerger, ResourceMerger);
            expect(assertTypeEquals).toHaveBeenCalledWith(mockPreSaveManager, PreSaveManager);
            expect(assertTypeEquals).toHaveBeenCalledWith(mockDatabaseQueryFactory, DatabaseQueryFactory);
            expect(assertTypeEquals).toHaveBeenCalledWith(mockConfigManager, ConfigManager);
            expect(assertTypeEquals).toHaveBeenCalledWith(mockBase64DataManager, Base64DataManager);
        });

        test('should call assertTypeEquals exactly 6 times', () => {
            createFactory();

            expect(assertTypeEquals).toHaveBeenCalledTimes(6);
        });
    });

    describe('createDatabaseUpdateManager', () => {
        let factory;

        beforeEach(() => {
            factory = createFactory();
        });

        test('should create DatabaseUpdateManager with all dependencies', () => {
            const result = factory.createDatabaseUpdateManager({
                resourceType: 'Patient',
                base_version: '4_0_0'
            });

            expect(DatabaseUpdateManager).toHaveBeenCalledWith({
                resourceLocatorFactory: mockResourceLocatorFactory,
                resourceMerger: mockResourceMerger,
                preSaveManager: mockPreSaveManager,
                databaseQueryFactory: mockDatabaseQueryFactory,
                configManager: mockConfigManager,
                base64DataManager: mockBase64DataManager,
                resourceType: 'Patient',
                base_version: '4_0_0'
            });
            expect(result._isDatabaseUpdateManager).toBe(true);
        });

        test('should pass different resource types', () => {
            factory.createDatabaseUpdateManager({
                resourceType: 'Observation',
                base_version: '4_0_0'
            });

            expect(DatabaseUpdateManager).toHaveBeenCalledWith(
                expect.objectContaining({
                    resourceType: 'Observation'
                })
            );
        });

        test('should pass different base_version values', () => {
            factory.createDatabaseUpdateManager({
                resourceType: 'Patient',
                base_version: '3_0_1'
            });

            expect(DatabaseUpdateManager).toHaveBeenCalledWith(
                expect.objectContaining({
                    base_version: '3_0_1'
                })
            );
        });

        test('should return a new instance each time', () => {
            const result1 = factory.createDatabaseUpdateManager({
                resourceType: 'Patient',
                base_version: '4_0_0'
            });

            const result2 = factory.createDatabaseUpdateManager({
                resourceType: 'Patient',
                base_version: '4_0_0'
            });

            expect(result1).not.toBe(result2);
            expect(DatabaseUpdateManager).toHaveBeenCalledTimes(2);
        });

        test('should use same dependencies for all created managers', () => {
            factory.createDatabaseUpdateManager({
                resourceType: 'Patient',
                base_version: '4_0_0'
            });

            factory.createDatabaseUpdateManager({
                resourceType: 'Observation',
                base_version: '4_0_0'
            });

            const calls = DatabaseUpdateManager.mock.calls;
            expect(calls[0][0].resourceLocatorFactory).toBe(calls[1][0].resourceLocatorFactory);
            expect(calls[0][0].resourceMerger).toBe(calls[1][0].resourceMerger);
            expect(calls[0][0].preSaveManager).toBe(calls[1][0].preSaveManager);
            expect(calls[0][0].databaseQueryFactory).toBe(calls[1][0].databaseQueryFactory);
            expect(calls[0][0].configManager).toBe(calls[1][0].configManager);
            expect(calls[0][0].base64DataManager).toBe(calls[1][0].base64DataManager);
        });
    });

    describe('createFastDatabaseUpdateManager', () => {
        let factory;

        beforeEach(() => {
            factory = createFactory();
        });

        test('should create FastDatabaseUpdateManager with all dependencies', () => {
            const result = factory.createFastDatabaseUpdateManager({
                resourceType: 'Patient',
                base_version: '4_0_0'
            });

            expect(FastDatabaseUpdateManager).toHaveBeenCalledWith({
                resourceLocatorFactory: mockResourceLocatorFactory,
                resourceMerger: mockResourceMerger,
                preSaveManager: mockPreSaveManager,
                databaseQueryFactory: mockDatabaseQueryFactory,
                configManager: mockConfigManager,
                base64DataManager: mockBase64DataManager,
                resourceType: 'Patient',
                base_version: '4_0_0'
            });
            expect(result._isFastDatabaseUpdateManager).toBe(true);
        });

        test('should pass different resource types', () => {
            factory.createFastDatabaseUpdateManager({
                resourceType: 'Condition',
                base_version: '4_0_0'
            });

            expect(FastDatabaseUpdateManager).toHaveBeenCalledWith(
                expect.objectContaining({
                    resourceType: 'Condition'
                })
            );
        });

        test('should pass different base_version values', () => {
            factory.createFastDatabaseUpdateManager({
                resourceType: 'Patient',
                base_version: '3_0_1'
            });

            expect(FastDatabaseUpdateManager).toHaveBeenCalledWith(
                expect.objectContaining({
                    base_version: '3_0_1'
                })
            );
        });

        test('should return a new instance each time', () => {
            const result1 = factory.createFastDatabaseUpdateManager({
                resourceType: 'Patient',
                base_version: '4_0_0'
            });

            const result2 = factory.createFastDatabaseUpdateManager({
                resourceType: 'Patient',
                base_version: '4_0_0'
            });

            expect(result1).not.toBe(result2);
            expect(FastDatabaseUpdateManager).toHaveBeenCalledTimes(2);
        });

        test('should use same dependencies for all created managers', () => {
            factory.createFastDatabaseUpdateManager({
                resourceType: 'Patient',
                base_version: '4_0_0'
            });

            factory.createFastDatabaseUpdateManager({
                resourceType: 'Observation',
                base_version: '4_0_0'
            });

            const calls = FastDatabaseUpdateManager.mock.calls;
            expect(calls[0][0].resourceLocatorFactory).toBe(calls[1][0].resourceLocatorFactory);
            expect(calls[0][0].resourceMerger).toBe(calls[1][0].resourceMerger);
            expect(calls[0][0].preSaveManager).toBe(calls[1][0].preSaveManager);
            expect(calls[0][0].configManager).toBe(calls[1][0].configManager);
        });
    });

    describe('createDatabaseUpdateManager vs createFastDatabaseUpdateManager', () => {
        test('should create different types of managers', () => {
            const factory = createFactory();

            const updateManager = factory.createDatabaseUpdateManager({
                resourceType: 'Patient',
                base_version: '4_0_0'
            });

            const fastUpdateManager = factory.createFastDatabaseUpdateManager({
                resourceType: 'Patient',
                base_version: '4_0_0'
            });

            expect(updateManager._isDatabaseUpdateManager).toBe(true);
            expect(updateManager._isFastDatabaseUpdateManager).toBeUndefined();
            expect(fastUpdateManager._isFastDatabaseUpdateManager).toBe(true);
            expect(fastUpdateManager._isDatabaseUpdateManager).toBeUndefined();
        });

        test('should pass same params to both manager types', () => {
            const factory = createFactory();

            factory.createDatabaseUpdateManager({
                resourceType: 'Patient',
                base_version: '4_0_0'
            });

            factory.createFastDatabaseUpdateManager({
                resourceType: 'Patient',
                base_version: '4_0_0'
            });

            const updateManagerParams = DatabaseUpdateManager.mock.calls[0][0];
            const fastUpdateManagerParams = FastDatabaseUpdateManager.mock.calls[0][0];

            expect(updateManagerParams.resourceLocatorFactory).toBe(fastUpdateManagerParams.resourceLocatorFactory);
            expect(updateManagerParams.resourceMerger).toBe(fastUpdateManagerParams.resourceMerger);
            expect(updateManagerParams.preSaveManager).toBe(fastUpdateManagerParams.preSaveManager);
            expect(updateManagerParams.databaseQueryFactory).toBe(fastUpdateManagerParams.databaseQueryFactory);
            expect(updateManagerParams.configManager).toBe(fastUpdateManagerParams.configManager);
            expect(updateManagerParams.base64DataManager).toBe(fastUpdateManagerParams.base64DataManager);
            expect(updateManagerParams.resourceType).toBe(fastUpdateManagerParams.resourceType);
            expect(updateManagerParams.base_version).toBe(fastUpdateManagerParams.base_version);
        });
    });
});
