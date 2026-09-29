'use strict';

const { describe, test, beforeEach, expect, jest: jestObj } = require('@jest/globals');

// Mock assertType before importing the class under test
jestObj.mock('../../../utils/assertType', () => ({
    assertTypeEquals: jestObj.fn(),
    assertIsValid: jestObj.fn()
}));

// Mock uid.util
jestObj.mock('../../../utils/uid.util', () => ({
    isUuid: jestObj.fn()
}));

// Mock moment-timezone
jestObj.mock('moment-timezone', () => {
    const mockMoment = {
        format: jestObj.fn().mockReturnValue('2024-01-01T00:00:00.000+0000')
    };
    const momentFn = () => mockMoment;
    momentFn.utc = () => mockMoment;
    return momentFn;
});

const { DatabaseExportManager } = require('../../../dataLayer/databaseExportManager');
const { isUuid } = require('../../../utils/uid.util');
const { assertIsValid } = require('../../../utils/assertType');

describe('DatabaseExportManager', () => {
    let manager;
    let mockDatabaseQueryFactory;
    let mockDatabaseUpdateFactory;
    let mockPostSaveProcessor;
    let mockDatabaseQueryManager;
    let mockDatabaseUpdateManager;

    beforeEach(() => {
        mockDatabaseQueryManager = {
            findOneAsync: jestObj.fn().mockResolvedValue(null)
        };

        mockDatabaseUpdateManager = {
            insertOneAsync: jestObj.fn().mockResolvedValue(undefined),
            updateOneAsync: jestObj.fn().mockResolvedValue(undefined)
        };

        mockDatabaseQueryFactory = {
            createQuery: jestObj.fn().mockReturnValue(mockDatabaseQueryManager)
        };

        mockDatabaseUpdateFactory = {
            createDatabaseUpdateManager: jestObj.fn().mockReturnValue(mockDatabaseUpdateManager)
        };

        mockPostSaveProcessor = {
            afterSaveAsync: jestObj.fn().mockResolvedValue(undefined)
        };

        manager = new DatabaseExportManager({
            databaseQueryFactory: mockDatabaseQueryFactory,
            databaseUpdateFactory: mockDatabaseUpdateFactory,
            postSaveProcessor: mockPostSaveProcessor
        });
    });

    describe('constructor', () => {
        test('assigns databaseQueryFactory', () => {
            expect(manager.databaseQueryFactory).toBe(mockDatabaseQueryFactory);
        });

        test('assigns databaseUpdateFactory', () => {
            expect(manager.databaseUpdateFactory).toBe(mockDatabaseUpdateFactory);
        });

        test('assigns postSaveProcessor', () => {
            expect(manager.postSaveProcessor).toBe(mockPostSaveProcessor);
        });
    });

    describe('getExportStatusResourceWithId', () => {
        test('calls assertIsValid with exportStatusId', async () => {
            await manager.getExportStatusResourceWithId({ exportStatusId: 'test-id' });
            expect(assertIsValid).toHaveBeenCalledWith('test-id', 'exportStatusId is required');
        });

        test('creates query with ExportStatus resourceType and base_version 4_0_0', async () => {
            await manager.getExportStatusResourceWithId({ exportStatusId: 'test-id' });
            expect(mockDatabaseQueryFactory.createQuery).toHaveBeenCalledWith({
                resourceType: 'ExportStatus',
                base_version: '4_0_0'
            });
        });

        test('queries by _uuid when exportStatusId is a uuid', async () => {
            isUuid.mockReturnValue(true);
            await manager.getExportStatusResourceWithId({ exportStatusId: 'some-uuid' });
            expect(mockDatabaseQueryManager.findOneAsync).toHaveBeenCalledWith({
                query: { _uuid: 'some-uuid' }
            });
        });

        test('queries by _sourceId when exportStatusId is not a uuid', async () => {
            isUuid.mockReturnValue(false);
            await manager.getExportStatusResourceWithId({ exportStatusId: 'some-source-id' });
            expect(mockDatabaseQueryManager.findOneAsync).toHaveBeenCalledWith({
                query: { _sourceId: 'some-source-id' }
            });
        });

        test('returns the found resource', async () => {
            const mockResource = { id: 'export-1', resourceType: 'ExportStatus' };
            mockDatabaseQueryManager.findOneAsync.mockResolvedValue(mockResource);
            isUuid.mockReturnValue(false);

            const result = await manager.getExportStatusResourceWithId({ exportStatusId: 'export-1' });
            expect(result).toBe(mockResource);
        });

        test('returns null when no resource found', async () => {
            mockDatabaseQueryManager.findOneAsync.mockResolvedValue(null);
            isUuid.mockReturnValue(false);

            const result = await manager.getExportStatusResourceWithId({ exportStatusId: 'missing' });
            expect(result).toBeNull();
        });

        test('throws RethrownError when findOneAsync fails', async () => {
            isUuid.mockReturnValue(false);
            mockDatabaseQueryManager.findOneAsync.mockRejectedValue(new Error('DB error'));

            await expect(
                manager.getExportStatusResourceWithId({ exportStatusId: 'test-id' })
            ).rejects.toThrow('Error in getExportStatusResourceWithId');
        });
    });

    describe('insertExportStatusAsync', () => {
        let mockExportStatusResource;

        beforeEach(() => {
            mockExportStatusResource = {
                id: 'export-1',
                meta: { lastUpdated: null, version: null }
            };
        });

        test('sets meta.lastUpdated to a Date', async () => {
            await manager.insertExportStatusAsync({
                exportStatusResource: mockExportStatusResource,
                requestId: 'req-1'
            });
            expect(mockExportStatusResource.meta.lastUpdated).toBeInstanceOf(Date);
        });

        test('sets meta.version to "1"', async () => {
            await manager.insertExportStatusAsync({
                exportStatusResource: mockExportStatusResource,
                requestId: 'req-1'
            });
            expect(mockExportStatusResource.meta.version).toBe('1');
        });

        test('creates database update manager with ExportStatus and base_version 4_0_0', async () => {
            await manager.insertExportStatusAsync({
                exportStatusResource: mockExportStatusResource,
                requestId: 'req-1'
            });
            expect(mockDatabaseUpdateFactory.createDatabaseUpdateManager).toHaveBeenCalledWith({
                resourceType: 'ExportStatus',
                base_version: '4_0_0'
            });
        });

        test('calls insertOneAsync with the export status resource', async () => {
            await manager.insertExportStatusAsync({
                exportStatusResource: mockExportStatusResource,
                requestId: 'req-1'
            });
            expect(mockDatabaseUpdateManager.insertOneAsync).toHaveBeenCalledWith({
                doc: mockExportStatusResource
            });
        });

        test('calls postSaveProcessor.afterSaveAsync with correct params', async () => {
            await manager.insertExportStatusAsync({
                exportStatusResource: mockExportStatusResource,
                requestId: 'req-1'
            });
            expect(mockPostSaveProcessor.afterSaveAsync).toHaveBeenCalledWith({
                requestId: 'req-1',
                eventType: 'C',
                resourceType: 'ExportStatus',
                doc: mockExportStatusResource
            });
        });

        test('throws RethrownError when insertOneAsync fails', async () => {
            mockDatabaseUpdateManager.insertOneAsync.mockRejectedValue(new Error('Insert failed'));

            await expect(
                manager.insertExportStatusAsync({
                    exportStatusResource: mockExportStatusResource,
                    requestId: 'req-1'
                })
            ).rejects.toThrow('Error in insertExportStatusAsync');
        });

        test('throws RethrownError when afterSaveAsync fails', async () => {
            mockPostSaveProcessor.afterSaveAsync.mockRejectedValue(new Error('Post save failed'));

            await expect(
                manager.insertExportStatusAsync({
                    exportStatusResource: mockExportStatusResource,
                    requestId: 'req-1'
                })
            ).rejects.toThrow('Error in insertExportStatusAsync');
        });
    });

    describe('updateExportStatusAsync', () => {
        let mockExportStatusResource;

        beforeEach(() => {
            mockExportStatusResource = {
                id: 'export-1',
                meta: { lastUpdated: null, versionId: '2' }
            };
        });

        test('sets meta.lastUpdated to a Date', async () => {
            await manager.updateExportStatusAsync({
                exportStatusResource: mockExportStatusResource
            });
            expect(mockExportStatusResource.meta.lastUpdated).toBeInstanceOf(Date);
        });

        test('increments meta.versionId', async () => {
            await manager.updateExportStatusAsync({
                exportStatusResource: mockExportStatusResource
            });
            expect(mockExportStatusResource.meta.versionId).toBe('3');
        });

        test('creates database update manager with ExportStatus and base_version 4_0_0', async () => {
            await manager.updateExportStatusAsync({
                exportStatusResource: mockExportStatusResource
            });
            expect(mockDatabaseUpdateFactory.createDatabaseUpdateManager).toHaveBeenCalledWith({
                resourceType: 'ExportStatus',
                base_version: '4_0_0'
            });
        });

        test('calls updateOneAsync with the export status resource', async () => {
            await manager.updateExportStatusAsync({
                exportStatusResource: mockExportStatusResource
            });
            expect(mockDatabaseUpdateManager.updateOneAsync).toHaveBeenCalledWith({
                doc: mockExportStatusResource
            });
        });

        test('throws RethrownError when updateOneAsync fails', async () => {
            mockDatabaseUpdateManager.updateOneAsync.mockRejectedValue(new Error('Update failed'));

            await expect(
                manager.updateExportStatusAsync({
                    exportStatusResource: mockExportStatusResource
                })
            ).rejects.toThrow('Error in updateExportStatusAsync');
        });
    });
});
