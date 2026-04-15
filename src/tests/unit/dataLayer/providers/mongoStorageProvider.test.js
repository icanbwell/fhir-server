const { describe, test, expect, beforeEach, jest } = require('@jest/globals');
const { MongoStorageProvider } = require('../../../../dataLayer/providers/mongoStorageProvider');
const { DatabaseCursor } = require('../../../../dataLayer/databaseCursor');

describe('MongoStorageProvider', () => {
    let provider;
    let mockResourceLocator;
    let mockDatabaseAttachmentManager;
    let mockCollection;

    beforeEach(() => {
        mockCollection = {
            find: jest.fn(),
            findOne: jest.fn(),
            countDocuments: jest.fn()
        };

        mockResourceLocator = {
            _resourceType: 'Patient',
            _base_version: '4_0_0',
            getCollectionAsync: jest.fn().mockResolvedValue(mockCollection)
        };

        mockDatabaseAttachmentManager = {};

        provider = new MongoStorageProvider({
            resourceLocator: mockResourceLocator,
            databaseAttachmentManager: mockDatabaseAttachmentManager
        });
    });

    describe('findAsync', () => {
        test('should create DatabaseCursor from MongoDB find', async () => {
            const mockMongoCursor = {
                namespace: { collection: 'Patient_4_0_0', db: 'test' }
            };
            mockCollection.find.mockReturnValue(mockMongoCursor);

            const query = { id: 'patient-1' };
            const options = { limit: 10 };

            const result = await provider.findAsync({ query, options });

            expect(mockResourceLocator.getCollectionAsync).toHaveBeenCalled();
            expect(mockCollection.find).toHaveBeenCalledWith(query, options);
            expect(result).toBeInstanceOf(DatabaseCursor);
        });

        test('should handle queries without options', async () => {
            const mockMongoCursor = {
                namespace: { collection: 'Patient_4_0_0', db: 'test' }
            };
            mockCollection.find.mockReturnValue(mockMongoCursor);

            const result = await provider.findAsync({
                query: { active: true }
            });

            expect(mockCollection.find).toHaveBeenCalledWith(
                { active: true },
                undefined
            );
            expect(result).toBeInstanceOf(DatabaseCursor);
        });

        test('should pass extraInfo to getCollectionAsync', async () => {
            const mockMongoCursor = {
                namespace: { collection: 'Patient_4_0_0', db: 'test' }
            };
            mockCollection.find.mockReturnValue(mockMongoCursor);

            await provider.findAsync({
                query: {},
                options: {},
                extraInfo: { customField: 'value' }
            });

            expect(mockResourceLocator.getCollectionAsync).toHaveBeenCalledWith({
                extraInfo: { customField: 'value' }
            });
        });
    });

    describe('findOneAsync', () => {
        test('should return resource when found', async () => {
            const mockDoc = {
                resourceType: 'Patient',
                id: 'patient-1',
                name: [{ family: 'Test' }]
            };
            mockCollection.findOne.mockResolvedValue(mockDoc);

            const query = { id: 'patient-1' };
            const options = { projection: { id: 1, name: 1 } };

            const result = await provider.findOneAsync({ query, options });

            expect(mockCollection.findOne).toHaveBeenCalledWith(query, options);
            expect(result).toBeDefined();
            expect(result.resourceType).toBe('Patient');
        });

        test('should return null when resource not found', async () => {
            mockCollection.findOne.mockResolvedValue(null);

            const result = await provider.findOneAsync({
                query: { id: 'nonexistent' }
            });

            expect(result).toBeNull();
        });
    });

    describe('upsertAsync', () => {
        test('should return acknowledgment for dual-write scenarios', async () => {
            const resources = [
                { resourceType: 'Patient', id: 'patient-1' },
                { resourceType: 'Patient', id: 'patient-2' }
            ];

            const result = await provider.upsertAsync({ resources });

            expect(result).toEqual({
                acknowledged: true,
                insertedCount: 2
            });
        });
    });

    describe('countAsync', () => {
        test('should return count from MongoDB', async () => {
            mockCollection.countDocuments.mockResolvedValue(42);

            const query = { active: true };
            const result = await provider.countAsync({ query });

            expect(mockCollection.countDocuments).toHaveBeenCalledWith(query);
            expect(result).toBe(42);
        });

        test('should return 0 for no matches', async () => {
            mockCollection.countDocuments.mockResolvedValue(0);

            const result = await provider.countAsync({
                query: { id: 'nonexistent' }
            });

            expect(result).toBe(0);
        });
    });

    describe('getStorageType', () => {
        test('should return "mongo"', () => {
            expect(provider.getStorageType()).toBe('mongo');
        });
    });

    describe('getCollectionAsync', () => {
        test('should delegate to resourceLocator', async () => {
            const result = await provider.getCollectionAsync({ test: true });

            expect(mockResourceLocator.getCollectionAsync).toHaveBeenCalledWith({ test: true });
            expect(result).toBe(mockCollection);
        });
    });

    describe('getResourceLocator', () => {
        test('should return resourceLocator', () => {
            const result = provider.getResourceLocator();

            expect(result).toBe(mockResourceLocator);
        });
    });
});
