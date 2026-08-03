'use strict';

const { describe, test, beforeEach, expect, jest: jestObj } = require('@jest/globals');
const { DatabaseHistoryManager } = require('../../../dataLayer/databaseHistoryManager');
const { ResourceLocatorFactory } = require('../../../operations/common/resourceLocatorFactory');
const { RethrownError } = require('../../../utils/rethrownError');

function createPrototypedMock(RealClass) {
    const mock = Object.create(RealClass.prototype);
    return mock;
}

function createDatabaseHistoryManager(overrides = {}) {
    const resourceLocatorFactory = createPrototypedMock(ResourceLocatorFactory);

    const mockCursor = {
        toArray: jestObj.fn().mockResolvedValue([]),
        next: jestObj.fn().mockResolvedValue(null),
        hasNext: jestObj.fn().mockResolvedValue(false)
    };

    const mockCollection = {
        findOne: jestObj.fn().mockResolvedValue(null),
        find: jestObj.fn().mockReturnValue(mockCursor),
        collectionName: 'Patient_4_0_0_History'
    };

    const mockResourceLocator = {
        getHistoryCollectionAsync: jestObj.fn().mockResolvedValue(mockCollection)
    };

    resourceLocatorFactory.createResourceLocator = jestObj.fn().mockReturnValue(mockResourceLocator);

    const inst = new DatabaseHistoryManager({
        resourceLocatorFactory,
        resourceType: overrides.resourceType || 'Patient',
        base_version: overrides.base_version || '4_0_0'
    });

    inst._mockCollection = mockCollection;
    inst._mockResourceLocator = mockResourceLocator;
    inst._mockCursor = mockCursor;
    return inst;
}

describe('DatabaseHistoryManager', () => {
    let manager;

    beforeEach(() => {
        manager = createDatabaseHistoryManager();
    });

    describe('constructor', () => {
        test('creates instance with correct resourceType and base_version', () => {
            const mgr = createDatabaseHistoryManager({
                resourceType: 'Observation',
                base_version: '4_0_0'
            });
            expect(mgr._resourceType).toBe('Observation');
            expect(mgr._base_version).toBe('4_0_0');
        });

        test('throws if resourceLocatorFactory is not the correct type', () => {
            expect(() => new DatabaseHistoryManager({
                resourceLocatorFactory: {},
                resourceType: 'Patient',
                base_version: '4_0_0'
            })).toThrow();
        });
    });

    describe('findOneAsync', () => {
        test('returns resource and collectionName when found', async () => {
            const mockResource = { id: 'p1', resourceType: 'Patient' };
            manager._mockCollection.findOne.mockResolvedValue(mockResource);

            const result = await manager.findOneAsync({
                query: { _uuid: 'uuid-1' }
            });

            expect(result).toEqual({
                resource: mockResource,
                collectionName: 'Patient_4_0_0_History'
            });
        });

        test('returns null when resource is not found', async () => {
            manager._mockCollection.findOne.mockResolvedValue(null);

            const result = await manager.findOneAsync({
                query: { _uuid: 'nonexistent' }
            });

            expect(result).toBeNull();
        });

        test('passes query and options to collection.findOne', async () => {
            const query = { _uuid: 'uuid-1', 'meta.versionId': '2' };
            const options = { projection: { id: 1 } };

            await manager.findOneAsync({ query, options });

            expect(manager._mockCollection.findOne).toHaveBeenCalledWith(query, options);
        });

        test('uses empty options by default', async () => {
            const query = { _uuid: 'uuid-1' };

            await manager.findOneAsync({ query });

            expect(manager._mockCollection.findOne).toHaveBeenCalledWith(query, {});
        });

        test('throws RethrownError when collection throws', async () => {
            manager._mockCollection.findOne.mockRejectedValue(new Error('DB error'));

            await expect(manager.findOneAsync({ query: { _uuid: 'u1' } }))
                .rejects.toThrow(RethrownError);
        });
    });

    describe('findAsync', () => {
        test('returns a DatabaseCursor', async () => {
            const { DatabaseCursor } = require('../../../dataLayer/databaseCursor');

            const result = await manager.findAsync({
                query: { 'resource.id': 'p1' }
            });

            expect(result).toBeInstanceOf(DatabaseCursor);
        });

        test('passes query and options to collection.find', async () => {
            const query = { 'resource.id': 'p1' };
            const options = { sort: { 'meta.lastUpdated': -1 } };

            await manager.findAsync({ query, options });

            expect(manager._mockCollection.find).toHaveBeenCalledWith(query, options);
        });

        test('uses empty options by default', async () => {
            const query = { 'resource.id': 'p1' };

            await manager.findAsync({ query });

            expect(manager._mockCollection.find).toHaveBeenCalledWith(query, {});
        });

        test('creates cursor with correct base_version and resourceType', async () => {
            const mgr = createDatabaseHistoryManager({
                resourceType: 'Observation',
                base_version: '4_0_0'
            });

            const result = await mgr.findAsync({ query: {} });

            expect(result.base_version).toBe('4_0_0');
            expect(result.resourceType).toBe('Observation');
        });
    });
});
