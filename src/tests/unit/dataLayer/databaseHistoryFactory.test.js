'use strict';

const { describe, test, expect, beforeEach, jest: jestObj } = require('@jest/globals');

// Mock assertType to avoid real type checking in unit tests
jestObj.mock('../../../utils/assertType', () => ({
    assertTypeEquals: jestObj.fn(),
    assertIsValid: jestObj.fn()
}));

// Mock DatabaseHistoryManager
jestObj.mock('../../../dataLayer/databaseHistoryManager', () => ({
    DatabaseHistoryManager: jestObj.fn().mockImplementation((params) => ({
        resourceLocatorFactory: params.resourceLocatorFactory,
        resourceType: params.resourceType,
        base_version: params.base_version,
        _isDatabaseHistoryManager: true
    }))
}));

const { DatabaseHistoryFactory } = require('../../../dataLayer/databaseHistoryFactory');
const { DatabaseHistoryManager } = require('../../../dataLayer/databaseHistoryManager');
const { ResourceLocatorFactory } = require('../../../operations/common/resourceLocatorFactory');

describe('DatabaseHistoryFactory', () => {
    let mockResourceLocatorFactory;

    beforeEach(() => {
        jestObj.clearAllMocks();
        mockResourceLocatorFactory = Object.create(ResourceLocatorFactory.prototype);
        mockResourceLocatorFactory.createResourceLocator = jestObj.fn();
    });

    describe('constructor', () => {
        test('should store resourceLocatorFactory', () => {
            const factory = new DatabaseHistoryFactory({
                resourceLocatorFactory: mockResourceLocatorFactory
            });

            expect(factory.resourceLocatorFactory).toBe(mockResourceLocatorFactory);
        });

        test('should call assertTypeEquals with resourceLocatorFactory', () => {
            const { assertTypeEquals } = require('../../../utils/assertType');

            new DatabaseHistoryFactory({
                resourceLocatorFactory: mockResourceLocatorFactory
            });

            expect(assertTypeEquals).toHaveBeenCalledWith(
                mockResourceLocatorFactory,
                ResourceLocatorFactory
            );
        });
    });

    describe('createDatabaseHistoryManager', () => {
        let factory;

        beforeEach(() => {
            factory = new DatabaseHistoryFactory({
                resourceLocatorFactory: mockResourceLocatorFactory
            });
        });

        test('should create DatabaseHistoryManager with correct params', () => {
            const result = factory.createDatabaseHistoryManager({
                resourceType: 'Patient',
                base_version: '4_0_0'
            });

            expect(DatabaseHistoryManager).toHaveBeenCalledWith({
                resourceLocatorFactory: mockResourceLocatorFactory,
                resourceType: 'Patient',
                base_version: '4_0_0'
            });
            expect(result._isDatabaseHistoryManager).toBe(true);
        });

        test('should pass through different resource types', () => {
            factory.createDatabaseHistoryManager({
                resourceType: 'Observation',
                base_version: '4_0_0'
            });

            expect(DatabaseHistoryManager).toHaveBeenCalledWith({
                resourceLocatorFactory: mockResourceLocatorFactory,
                resourceType: 'Observation',
                base_version: '4_0_0'
            });
        });

        test('should pass through different base_version values', () => {
            factory.createDatabaseHistoryManager({
                resourceType: 'Patient',
                base_version: '3_0_1'
            });

            expect(DatabaseHistoryManager).toHaveBeenCalledWith({
                resourceLocatorFactory: mockResourceLocatorFactory,
                resourceType: 'Patient',
                base_version: '3_0_1'
            });
        });

        test('should return a new instance each time', () => {
            const result1 = factory.createDatabaseHistoryManager({
                resourceType: 'Patient',
                base_version: '4_0_0'
            });

            const result2 = factory.createDatabaseHistoryManager({
                resourceType: 'Patient',
                base_version: '4_0_0'
            });

            expect(result1).not.toBe(result2);
        });

        test('should use the factory resourceLocatorFactory for all instances', () => {
            factory.createDatabaseHistoryManager({
                resourceType: 'Patient',
                base_version: '4_0_0'
            });

            factory.createDatabaseHistoryManager({
                resourceType: 'Observation',
                base_version: '4_0_0'
            });

            expect(DatabaseHistoryManager).toHaveBeenCalledTimes(2);
            const calls = DatabaseHistoryManager.mock.calls;
            expect(calls[0][0].resourceLocatorFactory).toBe(mockResourceLocatorFactory);
            expect(calls[1][0].resourceLocatorFactory).toBe(mockResourceLocatorFactory);
        });
    });
});
