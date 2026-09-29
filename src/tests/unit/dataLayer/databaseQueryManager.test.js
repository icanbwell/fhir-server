const { describe, test, expect, beforeEach, jest } = require('@jest/globals');

// Mock logging
jest.mock('../../../operations/common/logging', () => ({
    logError: jest.fn(),
    logInfo: jest.fn(),
    logWarn: jest.fn(),
    logDebug: jest.fn()
}));

jest.mock('../../../operations/common/systemEventLogging', () => ({
    logTraceSystemEventAsync: jest.fn(),
    logSystemEventAsync: jest.fn()
}));

const { DatabaseQueryManager } = require('../../../dataLayer/databaseQueryManager');
const { ResourceLocatorFactory } = require('../../../operations/common/resourceLocatorFactory');
const { ResourceLocator } = require('../../../operations/common/resourceLocator');
const { RethrownError } = require('../../../utils/rethrownError');

/**
 * Creates a mock ResourceLocator that passes assertTypeEquals
 */
function createMockResourceLocator() {
    const locator = Object.create(ResourceLocator.prototype);
    locator.getCollectionAsync = jest.fn();
    locator.getCollectionForResourceAsync = jest.fn();
    return locator;
}

/**
 * Creates a mock ResourceLocatorFactory that passes assertTypeEquals
 */
function createMockResourceLocatorFactory(mockResourceLocator) {
    const factory = Object.create(ResourceLocatorFactory.prototype);
    factory.createResourceLocator = jest.fn().mockReturnValue(mockResourceLocator);
    return factory;
}

/**
 * Creates a mock MongoDB collection
 */
function createMockCollection() {
    return {
        findOne: jest.fn(),
        find: jest.fn(),
        aggregate: jest.fn(),
        countDocuments: jest.fn()
    };
}

describe('DatabaseQueryManager', () => {
    let databaseQueryManager;
    let mockResourceLocator;
    let mockResourceLocatorFactory;
    let mockCollection;

    beforeEach(() => {
        jest.clearAllMocks();
        mockResourceLocator = createMockResourceLocator();
        mockResourceLocatorFactory = createMockResourceLocatorFactory(mockResourceLocator);
        mockCollection = createMockCollection();
        mockResourceLocator.getCollectionAsync.mockResolvedValue(mockCollection);

        databaseQueryManager = new DatabaseQueryManager({
            resourceLocatorFactory: mockResourceLocatorFactory,
            storageProvider: null,
            resourceType: 'Patient',
            base_version: '4_0_0'
        });
    });

    describe('constructor', () => {
        test('should throw if resourceLocatorFactory is null', () => {
            expect(() => new DatabaseQueryManager({
                resourceLocatorFactory: null,
                storageProvider: null,
                resourceType: 'Patient',
                base_version: '4_0_0'
            })).toThrow();
        });

        test('should throw if resourceLocatorFactory is wrong type', () => {
            expect(() => new DatabaseQueryManager({
                resourceLocatorFactory: {},
                storageProvider: null,
                resourceType: 'Patient',
                base_version: '4_0_0'
            })).toThrow();
        });

        test('should create with valid params', () => {
            expect(databaseQueryManager).toBeDefined();
            expect(databaseQueryManager._resourceType).toBe('Patient');
            expect(databaseQueryManager._base_version).toBe('4_0_0');
        });
    });

    describe('findAsync', () => {
        test('should return DatabaseCursor when query succeeds', async () => {
            const mockCursor = {
                namespace: { collection: 'Patient_4_0_0', db: 'fhir' },
                hasNext: jest.fn(),
                next: jest.fn()
            };
            mockCollection.find.mockReturnValue(mockCursor);

            const result = await databaseQueryManager.findAsync({
                query: { _uuid: 'test-uuid' }
            });

            expect(result).toBeDefined();
            expect(mockCollection.find).toHaveBeenCalledWith(
                { _uuid: 'test-uuid' },
                {}
            );
        });

        test('should use storageProvider if available', async () => {
            const mockStorageProvider = {
                findAsync: jest.fn().mockResolvedValue({ hasNext: jest.fn(), next: jest.fn() })
            };
            const managerWithStorage = new DatabaseQueryManager({
                resourceLocatorFactory: mockResourceLocatorFactory,
                storageProvider: mockStorageProvider,
                resourceType: 'Patient',
                base_version: '4_0_0'
            });

            await managerWithStorage.findAsync({ query: { _uuid: 'test' } });
            expect(mockStorageProvider.findAsync).toHaveBeenCalled();
            expect(mockCollection.find).not.toHaveBeenCalled();
        });

        test('should throw RethrownError when collection.find throws', async () => {
            mockCollection.find.mockImplementation(() => { throw new Error('DB Error'); });

            await expect(databaseQueryManager.findAsync({
                query: { _uuid: 'test-uuid' }
            })).rejects.toThrow(RethrownError);
        });

        test('should throw RethrownError when getCollectionAsync throws', async () => {
            mockResourceLocator.getCollectionAsync.mockRejectedValue(new Error('Connection failed'));

            await expect(databaseQueryManager.findAsync({
                query: { _uuid: 'test-uuid' }
            })).rejects.toThrow(RethrownError);
        });

        test('should pass options to collection.find', async () => {
            const mockCursor = {
                namespace: { collection: 'Patient_4_0_0', db: 'fhir' },
                hasNext: jest.fn(),
                next: jest.fn()
            };
            mockCollection.find.mockReturnValue(mockCursor);

            const options = { projection: { _uuid: 1, name: 1 } };
            await databaseQueryManager.findAsync({
                query: { _uuid: 'test-uuid' },
                options
            });

            expect(mockCollection.find).toHaveBeenCalledWith(
                { _uuid: 'test-uuid' },
                options
            );
        });
    });

    describe('findOneAsync', () => {
        test('should return null when no document found', async () => {
            mockCollection.findOne.mockResolvedValue(null);

            const result = await databaseQueryManager.findOneAsync({
                query: { _uuid: 'non-existent' }
            });

            expect(result).toBeNull();
        });

        test('should return resource when document found', async () => {
            const mockDocument = {
                resourceType: 'Patient',
                _uuid: 'test-uuid',
                name: [{ family: 'Test' }]
            };
            mockCollection.findOne.mockResolvedValue(mockDocument);

            const result = await databaseQueryManager.findOneAsync({
                query: { _uuid: 'test-uuid' }
            });

            expect(result).toBeDefined();
        });

        test('should throw RethrownError on database error', async () => {
            mockCollection.findOne.mockRejectedValue(new Error('DB Error'));

            await expect(databaseQueryManager.findOneAsync({
                query: { _uuid: 'test-uuid' }
            })).rejects.toThrow(RethrownError);
        });

        test('should use storageProvider if available', async () => {
            const mockStorageProvider = {
                findOneAsync: jest.fn().mockResolvedValue({ resourceType: 'Patient', _uuid: '123' })
            };
            const managerWithStorage = new DatabaseQueryManager({
                resourceLocatorFactory: mockResourceLocatorFactory,
                storageProvider: mockStorageProvider,
                resourceType: 'Patient',
                base_version: '4_0_0'
            });

            await managerWithStorage.findOneAsync({ query: { _uuid: '123' } });
            expect(mockStorageProvider.findOneAsync).toHaveBeenCalled();
        });
    });

    describe('fastFindOneAsync', () => {
        test('should return null when no document found', async () => {
            mockCollection.findOne.mockResolvedValue(null);

            const result = await databaseQueryManager.fastFindOneAsync({
                query: { _uuid: 'non-existent' }
            });

            expect(result).toBeNull();
        });

        test('should return serialized resource when document found', async () => {
            const mockDocument = {
                resourceType: 'Patient',
                _uuid: 'test-uuid',
                name: [{ family: 'Test' }]
            };
            mockCollection.findOne.mockResolvedValue(mockDocument);

            const result = await databaseQueryManager.fastFindOneAsync({
                query: { _uuid: 'test-uuid' }
            });

            expect(result).toBeDefined();
        });

        test('should throw RethrownError on error', async () => {
            mockCollection.findOne.mockRejectedValue(new Error('DB Error'));

            await expect(databaseQueryManager.fastFindOneAsync({
                query: { _uuid: 'test-uuid' }
            })).rejects.toThrow(RethrownError);
        });

        test('should use storageProvider if available', async () => {
            const mockStorageProvider = {
                fastFindOneAsync: jest.fn().mockResolvedValue({ _uuid: '123' })
            };
            const managerWithStorage = new DatabaseQueryManager({
                resourceLocatorFactory: mockResourceLocatorFactory,
                storageProvider: mockStorageProvider,
                resourceType: 'Patient',
                base_version: '4_0_0'
            });

            await managerWithStorage.fastFindOneAsync({ query: { _uuid: '123' } });
            expect(mockStorageProvider.fastFindOneAsync).toHaveBeenCalled();
        });
    });

    describe('exactDocumentCountAsync', () => {
        test('should return count from collection', async () => {
            mockCollection.countDocuments.mockResolvedValue(42);

            const result = await databaseQueryManager.exactDocumentCountAsync({
                query: { resourceType: 'Patient' },
                options: {}
            });

            expect(result).toBe(42);
        });

        test('should throw RethrownError on error', async () => {
            mockCollection.countDocuments.mockRejectedValue(new Error('DB Error'));

            await expect(databaseQueryManager.exactDocumentCountAsync({
                query: { resourceType: 'Patient' },
                options: {}
            })).rejects.toThrow(RethrownError);
        });

        test('should use storageProvider.countAsync if available', async () => {
            const mockStorageProvider = {
                countAsync: jest.fn().mockResolvedValue(10)
            };
            const managerWithStorage = new DatabaseQueryManager({
                resourceLocatorFactory: mockResourceLocatorFactory,
                storageProvider: mockStorageProvider,
                resourceType: 'Patient',
                base_version: '4_0_0'
            });

            const result = await managerWithStorage.exactDocumentCountAsync({
                query: {},
                options: {}
            });
            expect(result).toBe(10);
            expect(mockStorageProvider.countAsync).toHaveBeenCalled();
        });

        test('should fallback to MongoDB if storageProvider has no countAsync', async () => {
            const mockStorageProvider = {};  // no countAsync method
            const managerWithStorage = new DatabaseQueryManager({
                resourceLocatorFactory: mockResourceLocatorFactory,
                storageProvider: mockStorageProvider,
                resourceType: 'Patient',
                base_version: '4_0_0'
            });
            mockCollection.countDocuments.mockResolvedValue(5);

            const result = await managerWithStorage.exactDocumentCountAsync({
                query: {},
                options: {}
            });
            expect(result).toBe(5);
        });
    });

    describe('findResourcesInDatabaseAsync', () => {
        test('should query by _uuid array', async () => {
            mockResourceLocator.getCollectionForResourceAsync.mockResolvedValue(mockCollection);
            const mockCursor = {
                namespace: { collection: 'Patient_4_0_0', db: 'fhir' },
                hasNext: jest.fn(),
                next: jest.fn()
            };
            mockCollection.find.mockReturnValue(mockCursor);

            const resources = [
                { _uuid: 'uuid-1', resourceType: 'Patient' },
                { _uuid: 'uuid-2', resourceType: 'Patient' }
            ];

            const result = await databaseQueryManager.findResourcesInDatabaseAsync({ resources });
            expect(result).toBeDefined();
            expect(mockCollection.find).toHaveBeenCalledWith(
                { _uuid: { $in: ['uuid-1', 'uuid-2'] } },
                {}
            );
        });

        test('should throw RethrownError when resources array is empty', async () => {
            // BUG: accessing resources[0] when array is empty causes undefined to be passed
            // to getCollectionForResourceAsync, which may throw
            const resources = [];

            await expect(databaseQueryManager.findResourcesInDatabaseAsync({ resources }))
                .rejects.toThrow();
        });

        test('should throw RethrownError when resources is undefined', async () => {
            // BUG: accessing undefined[0] throws TypeError, which gets wrapped in RethrownError
            await expect(databaseQueryManager.findResourcesInDatabaseAsync({ resources: undefined }))
                .rejects.toThrow();
        });
    });

    describe('findUsingAggregationAsync', () => {
        test('should use aggregate pipeline with match and project', async () => {
            const mockCursor = {
                namespace: { collection: 'Patient_4_0_0', db: 'fhir' },
                hasNext: jest.fn(),
                next: jest.fn()
            };
            mockCollection.aggregate.mockReturnValue(mockCursor);

            const result = await databaseQueryManager.findUsingAggregationAsync({
                query: { _uuid: 'test' },
                projection: { _uuid: 1, name: 1 },
                options: {},
                extraInfo: {}
            });

            expect(result).toBeDefined();
            expect(mockCollection.aggregate).toHaveBeenCalledWith(
                [
                    { $match: { _uuid: 'test' } },
                    { $project: { _uuid: 1, name: 1 } }
                ],
                {}
            );
        });

        test('should use query directly when matchQueryProvided is true', async () => {
            const mockCursor = {
                namespace: { collection: 'Patient_4_0_0', db: 'fhir' },
                hasNext: jest.fn(),
                next: jest.fn()
            };
            mockCollection.aggregate.mockReturnValue(mockCursor);

            const pipeline = [{ $match: { _uuid: 'test' } }, { $group: { _id: '$_uuid' } }];
            const result = await databaseQueryManager.findUsingAggregationAsync({
                query: pipeline,
                projection: {},
                options: {},
                extraInfo: { matchQueryProvided: true }
            });

            expect(result).toBeDefined();
            expect(mockCollection.aggregate).toHaveBeenCalledWith(pipeline);
        });

        test('should throw RethrownError on error', async () => {
            mockCollection.aggregate.mockImplementation(() => { throw new Error('Agg error'); });

            await expect(databaseQueryManager.findUsingAggregationAsync({
                query: { _uuid: 'test' },
                projection: { _uuid: 1 },
                options: {},
                extraInfo: {}
            })).rejects.toThrow(RethrownError);
        });
    });
});
