'use strict';

const { describe, test, expect, jest: jestObj } = require('@jest/globals');

jestObj.mock('../../../../utils/assertType', () => ({
    assertTypeEquals: jestObj.fn(),
    assertIsValid: jestObj.fn()
}));

jestObj.mock('../../../../utils/mongoDatabaseManager', () => ({
    MongoDatabaseManager: class MongoDatabaseManager {}
}));

jestObj.mock('../../../../operations/common/resourceLocator', () => ({
    ResourceLocator: class ResourceLocator {
        constructor (opts) { Object.assign(this, opts); }
    }
}));

const { ResourceLocatorFactory } = require('../../../../operations/common/resourceLocatorFactory');

describe('ResourceLocatorFactory', () => {
    const mockMongoManager = { getClientDb: jestObj.fn() };

    test('stores mongoDatabaseManager', () => {
        const factory = new ResourceLocatorFactory({ mongoDatabaseManager: mockMongoManager });
        expect(factory.mongoDatabaseManager).toBe(mockMongoManager);
    });

    test('createResourceLocator returns ResourceLocator with correct params', () => {
        const factory = new ResourceLocatorFactory({ mongoDatabaseManager: mockMongoManager });
        const locator = factory.createResourceLocator({ resourceType: 'Patient', base_version: '4_0_0' });
        expect(locator.resourceType).toBe('Patient');
        expect(locator.base_version).toBe('4_0_0');
        expect(locator.mongoDatabaseManager).toBe(mockMongoManager);
    });

    test('createResourceLocator returns new instances each call', () => {
        const factory = new ResourceLocatorFactory({ mongoDatabaseManager: mockMongoManager });
        const l1 = factory.createResourceLocator({ resourceType: 'Patient', base_version: '4_0_0' });
        const l2 = factory.createResourceLocator({ resourceType: 'Patient', base_version: '4_0_0' });
        expect(l1).not.toBe(l2);
    });

    test('createResourceLocator works with different resource types', () => {
        const factory = new ResourceLocatorFactory({ mongoDatabaseManager: mockMongoManager });
        const locator = factory.createResourceLocator({ resourceType: 'Observation', base_version: '4_0_0' });
        expect(locator.resourceType).toBe('Observation');
    });
});
