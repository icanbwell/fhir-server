const { describe, test, expect, beforeEach, jest: jestObj } = require('@jest/globals');

// Mock assertType to bypass type checking in constructor
jestObj.mock('../../../../utils/assertType', () => ({
    assertTypeEquals: jestObj.fn(),
    assertIsValid: jestObj.fn((obj, message) => {
        if (!obj) {
            throw new Error(message || 'obj is null or undefined');
        }
    })
}));

const { ResourceLocator } = require('../../../../operations/common/resourceLocator');

describe('ResourceLocator', () => {
    let resourceLocator;
    let mockMongoDatabaseManager;
    let mockDb;
    let mockCollection;

    beforeEach(() => {
        mockCollection = { find: jestObj.fn(), insertOne: jestObj.fn() };
        mockDb = {
            collection: jestObj.fn().mockReturnValue(mockCollection)
        };
        mockMongoDatabaseManager = {
            getDatabaseForResourceAsync: jestObj.fn().mockResolvedValue(mockDb),
            getAccessLogsDbAsync: jestObj.fn().mockResolvedValue(mockDb)
        };
    });

    describe('constructor validation', () => {
        test('throws if resourceType is missing', () => {
            expect(() => {
                new ResourceLocator({
                    mongoDatabaseManager: mockMongoDatabaseManager,
                    resourceType: null,
                    base_version: '4_0_0'
                });
            }).toThrow('resourceType is not passed to ResourceLocator constructor');
        });

        test('throws if resourceType is empty string', () => {
            expect(() => {
                new ResourceLocator({
                    mongoDatabaseManager: mockMongoDatabaseManager,
                    resourceType: '',
                    base_version: '4_0_0'
                });
            }).toThrow('resourceType is not passed to ResourceLocator constructor');
        });

        test('throws if base_version is missing', () => {
            expect(() => {
                new ResourceLocator({
                    mongoDatabaseManager: mockMongoDatabaseManager,
                    resourceType: 'Patient',
                    base_version: null
                });
            }).toThrow('base_version is not passed to ResourceLocator constructor');
        });

        test('throws if base_version is empty string', () => {
            expect(() => {
                new ResourceLocator({
                    mongoDatabaseManager: mockMongoDatabaseManager,
                    resourceType: 'Patient',
                    base_version: ''
                });
            }).toThrow('base_version is not passed to ResourceLocator constructor');
        });

        test('succeeds with valid parameters', () => {
            expect(() => {
                new ResourceLocator({
                    mongoDatabaseManager: mockMongoDatabaseManager,
                    resourceType: 'Patient',
                    base_version: '4_0_0'
                });
            }).not.toThrow();
        });
    });

    describe('getCollectionName', () => {
        test('returns resourceType_base_version format', () => {
            resourceLocator = new ResourceLocator({
                mongoDatabaseManager: mockMongoDatabaseManager,
                resourceType: 'Patient',
                base_version: '4_0_0'
            });

            expect(resourceLocator.getCollectionName()).toBe('Patient_4_0_0');
        });

        test('works with different resource types', () => {
            resourceLocator = new ResourceLocator({
                mongoDatabaseManager: mockMongoDatabaseManager,
                resourceType: 'Observation',
                base_version: '4_0_0'
            });

            expect(resourceLocator.getCollectionName()).toBe('Observation_4_0_0');
        });

        test('works with different base versions', () => {
            resourceLocator = new ResourceLocator({
                mongoDatabaseManager: mockMongoDatabaseManager,
                resourceType: 'Patient',
                base_version: '3_0_1'
            });

            expect(resourceLocator.getCollectionName()).toBe('Patient_3_0_1');
        });
    });

    describe('getCollectionNameForResource', () => {
        beforeEach(() => {
            resourceLocator = new ResourceLocator({
                mongoDatabaseManager: mockMongoDatabaseManager,
                resourceType: 'Patient',
                base_version: '4_0_0'
            });
        });

        test('returns resource.resourceType_base_version format', () => {
            const resource = { resourceType: 'Encounter', id: '123' };
            expect(resourceLocator.getCollectionNameForResource(resource)).toBe('Encounter_4_0_0');
        });

        test('uses resource resourceType, not constructor resourceType', () => {
            const resource = { resourceType: 'Observation', id: '456' };
            expect(resourceLocator.getCollectionNameForResource(resource)).toBe('Observation_4_0_0');
        });

        test('throws if resource is null', () => {
            expect(() => {
                resourceLocator.getCollectionNameForResource(null);
            }).toThrow('resource is null');
        });

        test('throws if resource.resourceType is missing', () => {
            expect(() => {
                resourceLocator.getCollectionNameForResource({ id: '123' });
            }).toThrow('resourceType is null on resource');
        });
    });

    describe('getHistoryCollectionNameForResource', () => {
        beforeEach(() => {
            resourceLocator = new ResourceLocator({
                mongoDatabaseManager: mockMongoDatabaseManager,
                resourceType: 'Patient',
                base_version: '4_0_0'
            });
        });

        test('returns resourceType_base_version_History format', () => {
            const resource = { resourceType: 'Patient', id: '123' };
            expect(resourceLocator.getHistoryCollectionNameForResource(resource)).toBe('Patient_4_0_0_History');
        });

        test('uses resource resourceType for history collection name', () => {
            const resource = { resourceType: 'Encounter', id: '456' };
            expect(resourceLocator.getHistoryCollectionNameForResource(resource)).toBe('Encounter_4_0_0_History');
        });

        test('throws if resource is null', () => {
            expect(() => {
                resourceLocator.getHistoryCollectionNameForResource(null);
            }).toThrow('resource is null');
        });
    });

    describe('getHistoryCollectionAsync', () => {
        test('throws for AuditEvent resourceType (business rule: no history for audits)', async () => {
            resourceLocator = new ResourceLocator({
                mongoDatabaseManager: mockMongoDatabaseManager,
                resourceType: 'AuditEvent',
                base_version: '4_0_0'
            });

            await expect(resourceLocator.getHistoryCollectionAsync()).rejects.toThrow(
                "resourceType AuditEvent don't have a history collection"
            );
        });

        test('throws for resourceType ending in _History (prevents double-suffixing)', async () => {
            resourceLocator = new ResourceLocator({
                mongoDatabaseManager: mockMongoDatabaseManager,
                resourceType: 'Patient_4_0_0_History',
                base_version: '4_0_0'
            });

            await expect(resourceLocator.getHistoryCollectionAsync()).rejects.toThrow(
                'has an invalid postfix'
            );
        });

        test('returns collection with _History suffix for valid resourceType', async () => {
            resourceLocator = new ResourceLocator({
                mongoDatabaseManager: mockMongoDatabaseManager,
                resourceType: 'Patient',
                base_version: '4_0_0'
            });

            await resourceLocator.getHistoryCollectionAsync();

            expect(mockDb.collection).toHaveBeenCalledWith('Patient_4_0_0_History');
        });

        test('passes isHistoryQuery: true to getDatabaseForResourceAsync', async () => {
            resourceLocator = new ResourceLocator({
                mongoDatabaseManager: mockMongoDatabaseManager,
                resourceType: 'Observation',
                base_version: '4_0_0'
            });

            await resourceLocator.getHistoryCollectionAsync();

            expect(mockMongoDatabaseManager.getDatabaseForResourceAsync).toHaveBeenCalledWith({
                resourceType: 'Observation',
                extraInfo: { isHistoryQuery: true }
            });
        });
    });

    describe('getDatabaseConnectionAsync', () => {
        beforeEach(() => {
            resourceLocator = new ResourceLocator({
                mongoDatabaseManager: mockMongoDatabaseManager,
                resourceType: 'Patient',
                base_version: '4_0_0'
            });
        });

        test('delegates to mongoDatabaseManager.getDatabaseForResourceAsync', async () => {
            const result = await resourceLocator.getDatabaseConnectionAsync();

            expect(mockMongoDatabaseManager.getDatabaseForResourceAsync).toHaveBeenCalledWith({
                resourceType: 'Patient',
                extraInfo: {}
            });
            expect(result).toBe(mockDb);
        });

        test('passes extraInfo to mongoDatabaseManager', async () => {
            await resourceLocator.getDatabaseConnectionAsync({ isHistoryQuery: true });

            expect(mockMongoDatabaseManager.getDatabaseForResourceAsync).toHaveBeenCalledWith({
                resourceType: 'Patient',
                extraInfo: { isHistoryQuery: true }
            });
        });
    });

    describe('getAccessLogCollectionAsync', () => {
        beforeEach(() => {
            resourceLocator = new ResourceLocator({
                mongoDatabaseManager: mockMongoDatabaseManager,
                resourceType: 'Patient',
                base_version: '4_0_0'
            });
        });

        test('uses access logs database', async () => {
            await resourceLocator.getAccessLogCollectionAsync();

            expect(mockMongoDatabaseManager.getAccessLogsDbAsync).toHaveBeenCalled();
        });

        test('returns collection with access-logs name', async () => {
            await resourceLocator.getAccessLogCollectionAsync();

            expect(mockDb.collection).toHaveBeenCalledWith('access-logs');
        });
    });

    describe('getCollectionAsync', () => {
        beforeEach(() => {
            resourceLocator = new ResourceLocator({
                mongoDatabaseManager: mockMongoDatabaseManager,
                resourceType: 'Patient',
                base_version: '4_0_0'
            });
        });

        test('returns collection with correct name', async () => {
            const result = await resourceLocator.getCollectionAsync({ extraInfo: {} });

            expect(mockDb.collection).toHaveBeenCalledWith('Patient_4_0_0');
            expect(result).toBe(mockCollection);
        });
    });

    describe('getCollectionByNameAsync', () => {
        beforeEach(() => {
            resourceLocator = new ResourceLocator({
                mongoDatabaseManager: mockMongoDatabaseManager,
                resourceType: 'Patient',
                base_version: '4_0_0'
            });
        });

        test('passes isHistoryQuery: true when collection name ends with _History', async () => {
            await resourceLocator.getCollectionByNameAsync('Patient_4_0_0_History');

            expect(mockMongoDatabaseManager.getDatabaseForResourceAsync).toHaveBeenCalledWith({
                resourceType: 'Patient',
                extraInfo: { isHistoryQuery: true }
            });
        });

        test('passes isHistoryQuery: false when collection name does not end with _History', async () => {
            await resourceLocator.getCollectionByNameAsync('Patient_4_0_0');

            expect(mockMongoDatabaseManager.getDatabaseForResourceAsync).toHaveBeenCalledWith({
                resourceType: 'Patient',
                extraInfo: { isHistoryQuery: false }
            });
        });
    });
});
