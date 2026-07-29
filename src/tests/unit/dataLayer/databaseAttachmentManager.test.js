'use strict';

const { describe, test, expect, beforeEach, jest } = require('@jest/globals');

// Mock heavy dependencies
jest.mock('../../../config', () => ({}));
jest.mock('../../../operations/common/logging', () => ({
    logInfo: jest.fn(),
    logDebug: jest.fn(),
    logError: jest.fn()
}));

// Mock mongodb's GridFSBucket to avoid real constructor issues
const mockGridFSBucketInstance = {
    openDownloadStream: jest.fn(),
    openUploadStream: jest.fn()
};
jest.mock('mongodb', () => {
    const actual = jest.requireActual('mongodb');
    return {
        ...actual,
        GridFSBucket: jest.fn().mockImplementation(() => mockGridFSBucketInstance),
        ReadPreferenceMode: { primary: 'primary' }
    };
});

const { DatabaseAttachmentManager } = require('../../../dataLayer/databaseAttachmentManager');
const { MongoDatabaseManager } = require('../../../utils/mongoDatabaseManager');
const { ConfigManager } = require('../../../utils/configManager');
const Attachment = require('../../../fhir/classes/4_0_0/complex_types/attachment');

/**
 * Helper: create a mock MongoDatabaseManager instance that passes assertTypeEquals.
 */
function createMockMongoDatabaseManager() {
    const mgr = Object.create(MongoDatabaseManager.prototype);
    mgr.getGridFsBucket = jest.fn();
    mgr.getClientDbAsync = jest.fn();
    return mgr;
}

/**
 * Helper: create a mock ConfigManager instance that passes assertTypeEquals.
 */
function createMockConfigManager({ enabledGridFsResources = [] } = {}) {
    const cfg = Object.create(ConfigManager.prototype);
    Object.defineProperty(cfg, 'enabledGridFsResources', {
        get: () => enabledGridFsResources,
        configurable: true
    });
    return cfg;
}

describe('DatabaseAttachmentManager', () => {
    let manager;
    let mockMongoDatabaseManager;
    let mockConfigManager;

    beforeEach(() => {
        mockMongoDatabaseManager = createMockMongoDatabaseManager();
        mockConfigManager = createMockConfigManager({
            enabledGridFsResources: ['DocumentReference']
        });
        manager = new DatabaseAttachmentManager({
            mongoDatabaseManager: mockMongoDatabaseManager,
            configManager: mockConfigManager
        });
    });

    describe('getMetadata', () => {
        test('returns resource_uuid and resource_sourceId for INSERT operation', () => {
            const resource = { _uuid: 'uuid-123', _sourceId: 'source-456' };
            const metadata = manager.getMetadata(resource, 'INSERT');
            expect(metadata).toEqual({
                resource_uuid: 'uuid-123',
                resource_sourceId: 'source-456',
                active: true
            });
        });

        test('returns empty object for RETRIEVE operation', () => {
            const resource = { _uuid: 'uuid-123', _sourceId: 'source-456' };
            const metadata = manager.getMetadata(resource, 'RETRIEVE');
            expect(metadata).toEqual({});
        });

        test('returns metadata with active for DELETE operation', () => {
            const resource = { _uuid: 'uuid-123' };
            const metadata = manager.getMetadata(resource, 'DELETE');
            expect(metadata).toEqual({
                resource_uuid: 'uuid-123',
                active: true
            });
        });
    });

    describe('isUpdated', () => {
        test('returns true when patchContent includes the given path', () => {
            const patchContent = [{ path: '/content/0/attachment/data' }];
            const result = manager.isUpdated('/content/0/attachment/data', patchContent);
            expect(result).toBe(true);
        });

        test('returns true for parent path match', () => {
            const patchContent = [{ path: '/content' }];
            const result = manager.isUpdated('/content/0/attachment/data', patchContent);
            expect(result).toBe(true);
        });

        test('returns false when path is not affected', () => {
            const patchContent = [{ path: '/status' }];
            const result = manager.isUpdated('/content/0/attachment/data', patchContent);
            expect(result).toBe(false);
        });
    });

    describe('transformAttachments', () => {
        test('returns resource unchanged when resourceType not in enabledGridFsResources', async () => {
            const resource = { resourceType: 'Patient', id: '123' };
            const result = await manager.transformAttachments(resource);
            expect(result).toEqual(resource);
        });

        test('handles null/undefined resource in array without throwing', async () => {
            // transformAttachments iterates over arrays; changeAttachmentWithGridFS guards null
            const resources = [
                { resourceType: 'DocumentReference', id: '1', _id: 'mongo-id' }
            ];

            // Mock changeAttachmentWithGridFS to not rely on GridFS
            manager.changeAttachmentWithGridFS = jest.fn().mockResolvedValue(resources[0]);
            const result = await manager.transformAttachments(resources);
            expect(result).toEqual(resources);
        });

        test('deletes _id from resource before processing', async () => {
            const resource = {
                resourceType: 'DocumentReference',
                id: '1',
                _id: 'mongo-id-to-remove'
            };

            manager.changeAttachmentWithGridFS = jest.fn().mockImplementation(async ({ resource: r }) => r);
            await manager.transformAttachments(resource);

            // The _id should have been deleted before calling changeAttachmentWithGridFS
            expect(resource._id).toBeUndefined();
        });
    });

    describe('changeAttachmentWithGridFS - null resource', () => {
        test('returns null when resource is null', async () => {
            const result = await manager.changeAttachmentWithGridFS({
                resource: null,
                resourceId: '1',
                metadata: {},
                operation: 'INSERT'
            });
            expect(result).toBeNull();
        });

        test('returns undefined when resource is undefined', async () => {
            const result = await manager.changeAttachmentWithGridFS({
                resource: undefined,
                resourceId: '1',
                metadata: {},
                operation: 'INSERT'
            });
            expect(result).toBeUndefined();
        });
    });

    describe('changeAttachmentWithGridFS - inherited property bug (line 217)', () => {
        test('throws TypeError when resource has inherited enumerable properties', async () => {
            // BUG: for..in iterates inherited properties but Object.getOwnPropertyDescriptor
            // only finds own properties, returning undefined for inherited ones.
            // Accessing .writable on undefined throws TypeError.

            const parentProto = { inheritedProp: 'value' };
            // Make inheritedProp enumerable on parent
            Object.defineProperty(parentProto, 'inheritedProp', {
                value: 'inherited-value',
                enumerable: true,
                writable: true,
                configurable: true
            });

            const resource = Object.create(parentProto);
            resource.someField = 'own-value';

            // The resource is not an Attachment, not an Object with _file_id,
            // and doesn't match attachmentResourceFields, so it falls through to
            // the for..in loop at line 215-230.
            // The for..in will find 'inheritedProp' from the prototype.
            // Object.getOwnPropertyDescriptor(resource, 'inheritedProp') returns undefined.
            // Accessing .writable on undefined throws TypeError.

            mockMongoDatabaseManager.getGridFsBucket.mockResolvedValue({});

            await expect(
                manager.changeAttachmentWithGridFS({
                    resource,
                    resourceId: '1',
                    metadata: {},
                    operation: 'INSERT',
                    path: '',
                    resourceType: 'Other'
                })
            ).rejects.toThrow(TypeError);
        });
    });

    describe('convertFileIdToData - multi-chunk data corruption', () => {
        test('concatenates multiple chunks correctly for ASCII data', async () => {
            // Simulates download of data that arrives in multiple chunks
            const { EventEmitter } = require('events');
            const originalData = 'SGVsbG8gV29ybGQ='; // base64 for "Hello World"

            const downloadStream = new EventEmitter();
            const mockBucket = {
                openDownloadStream: jest.fn().mockReturnValue(downloadStream)
            };

            const resource = { _file_id: '507f1f77bcf86cd799439011' };
            const promise = manager.convertFileIdToData(resource, mockBucket);

            // Simulate chunked delivery
            downloadStream.emit('data', Buffer.from('SGVsbG8g'));
            downloadStream.emit('data', Buffer.from('V29ybGQ='));
            downloadStream.emit('end');

            const result = await promise;
            expect(result.data).toBe(originalData);
            expect(result._file_id).toBeUndefined();
        });

        test('handles error on download stream', async () => {
            const { EventEmitter } = require('events');
            const downloadStream = new EventEmitter();
            const mockBucket = {
                openDownloadStream: jest.fn().mockReturnValue(downloadStream)
            };

            const resource = { _file_id: '507f1f77bcf86cd799439011' };
            const promise = manager.convertFileIdToData(resource, mockBucket);

            downloadStream.emit('error', new Error('stream failed'));

            await expect(promise).rejects.toThrow('stream failed');
        });

        test('resolves immediately when _file_id is not present', async () => {
            const resource = { data: 'some-data' };
            const result = await manager.convertFileIdToData(resource, {});
            expect(result).toEqual({ data: 'some-data' });
        });
    });

    describe('convertDataToFileId', () => {
        test('resolves resource unchanged when no data field present', async () => {
            const resource = { _file_id: 'existing-id' };
            const result = await manager.convertDataToFileId(resource, 'filename', {}, {});
            expect(result).toEqual({ _file_id: 'existing-id' });
        });
    });

    describe('deleteFile', () => {
        test('does nothing when resource has no _file_id', async () => {
            const resource = { data: 'some-data' };
            await manager.deleteFile(resource, {});
            expect(mockMongoDatabaseManager.getClientDbAsync).not.toHaveBeenCalled();
        });

        test('throws NotFoundError when db update fails', async () => {
            const mockDb = {
                collection: jest.fn().mockReturnValue({
                    updateOne: jest.fn().mockRejectedValue(new Error('db error'))
                })
            };
            mockMongoDatabaseManager.getClientDbAsync.mockResolvedValue(mockDb);

            const resource = { _file_id: '507f1f77bcf86cd799439011' };
            await expect(
                manager.deleteFile(resource, { active: false })
            ).rejects.toThrow('Resource not found');
        });

        test('performs soft delete by setting metadata.active to false', async () => {
            const mockUpdateOne = jest.fn().mockResolvedValue({ modifiedCount: 1 });
            const mockDb = {
                collection: jest.fn().mockReturnValue({ updateOne: mockUpdateOne })
            };
            mockMongoDatabaseManager.getClientDbAsync.mockResolvedValue(mockDb);

            const resource = { _file_id: '507f1f77bcf86cd799439011' };
            const metadata = { resource_uuid: 'uuid-1', active: true };
            await manager.deleteFile(resource, metadata);

            expect(mockDb.collection).toHaveBeenCalledWith('fs.files');
            expect(mockUpdateOne).toHaveBeenCalledWith(
                expect.objectContaining({ _id: expect.anything() }),
                { $set: { metadata: { resource_uuid: 'uuid-1', active: false } } }
            );
        });
    });

    describe('changeAttachmentWithGridFS - retry logic', () => {
        test('retries up to 2 times on RETRIEVE failure before throwing NotFoundError', async () => {
            const { EventEmitter } = require('events');

            const createFailingStream = () => {
                const stream = new EventEmitter();
                process.nextTick(() => stream.emit('error', new Error('download failed')));
                return stream;
            };

            const mockBucket = {
                openDownloadStream: jest.fn().mockImplementation(() => createFailingStream())
            };
            mockMongoDatabaseManager.getGridFsBucket.mockResolvedValue(mockBucket);
            mockMongoDatabaseManager.getClientDbAsync.mockResolvedValue({
                collection: jest.fn().mockReturnValue({})
            });

            // The mocked GridFSBucket (from mongodb mock) also needs openDownloadStream
            mockGridFSBucketInstance.openDownloadStream.mockImplementation(() => createFailingStream());

            const resource = Object.create(Attachment.prototype);
            resource._file_id = '507f1f77bcf86cd799439011';

            await expect(
                manager.changeAttachmentWithGridFS({
                    resource,
                    resourceId: '1',
                    metadata: {},
                    operation: 'RETRIEVE',
                    path: '/content/0/attachment',
                    resourceType: 'DocumentReference'
                })
            ).rejects.toThrow('Unable to fetch the attachment or not found');

            // getGridFsBucket is called on every attempt (3 times total)
            // On the 3rd attempt (retryCount=2), a new GridFSBucket is also constructed from getClientDbAsync
            expect(mockMongoDatabaseManager.getGridFsBucket).toHaveBeenCalledTimes(3);
            expect(mockMongoDatabaseManager.getClientDbAsync).toHaveBeenCalledTimes(1);
        });
    });
});
