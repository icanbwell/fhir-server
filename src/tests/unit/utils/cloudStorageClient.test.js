/**
 * Unit tests for CloudStorageClient (abstract base class)
 * Verifies constructor validation, default method implementations throw 'Not Implemented',
 * and that the interface contract is correct.
 */
const { describe, test, expect, beforeEach, jest: jestObj } = require('@jest/globals');

jestObj.mock('../../../utils/assertType', () => ({
    assertIsValid: jestObj.fn((value, message) => {
        if (!value) {
            throw new Error(message || 'Assertion failed');
        }
    }),
    assertTypeEquals: jestObj.fn()
}));

const { CloudStorageClient } = require('../../../utils/cloudStorageClient');

describe('CloudStorageClient', () => {
    let client;

    beforeEach(() => {
        jestObj.clearAllMocks();
        client = new CloudStorageClient({ bucketName: 'test-bucket', region: 'us-east-1' });
    });

    describe('constructor', () => {
        test('sets bucketName and region', () => {
            expect(client.bucketName).toBe('test-bucket');
            expect(client.region).toBe('us-east-1');
        });

        test('throws when bucketName is not provided', () => {
            expect(() => new CloudStorageClient({ bucketName: '', region: 'us-east-1' }))
                .toThrow('Cannot initialize storage client without bucketName');
        });

        test('throws when bucketName is undefined', () => {
            expect(() => new CloudStorageClient({ bucketName: undefined, region: 'us-east-1' }))
                .toThrow('Cannot initialize storage client without bucketName');
        });

        test('throws when bucketName is null', () => {
            expect(() => new CloudStorageClient({ bucketName: null, region: 'us-east-1' }))
                .toThrow('Cannot initialize storage client without bucketName');
        });

        test('throws when region is not provided', () => {
            expect(() => new CloudStorageClient({ bucketName: 'bucket', region: '' }))
                .toThrow('Cannot initialize storage client without region');
        });

        test('throws when region is undefined', () => {
            expect(() => new CloudStorageClient({ bucketName: 'bucket', region: undefined }))
                .toThrow('Cannot initialize storage client without region');
        });

        test('throws when region is null', () => {
            expect(() => new CloudStorageClient({ bucketName: 'bucket', region: null }))
                .toThrow('Cannot initialize storage client without region');
        });
    });

    describe('getPublicFilePath', () => {
        test('throws Not Implemented', () => {
            expect(() => client.getPublicFilePath('path/to/file.json')).toThrow('Not Implemented');
        });
    });

    describe('uploadAsync', () => {
        test('throws Not Implemented', async () => {
            await expect(
                client.uploadAsync({ filePath: 'path/file.json', data: 'content' })
            ).rejects.toThrow('Not Implemented');
        });

        test('throws Not Implemented with ifNoneMatch option', async () => {
            await expect(
                client.uploadAsync({ filePath: 'path/file.json', data: 'content', ifNoneMatch: true })
            ).rejects.toThrow('Not Implemented');
        });
    });

    describe('existsAsync', () => {
        test('throws Not Implemented', async () => {
            await expect(client.existsAsync('path/to/file.json')).rejects.toThrow('Not Implemented');
        });
    });

    describe('listObjectsAsync', () => {
        test('throws Not Implemented', async () => {
            await expect(
                client.listObjectsAsync({ prefix: 'some/prefix/' })
            ).rejects.toThrow('Not Implemented');
        });
    });

    describe('createMultiPartUploadAsync', () => {
        test('throws Not Implemented', async () => {
            await expect(
                client.createMultiPartUploadAsync({ filePath: 'path/file.json' })
            ).rejects.toThrow('Not Implemented');
        });
    });

    describe('uploadPartAsync', () => {
        test('throws Not Implemented', async () => {
            await expect(
                client.uploadPartAsync({ filePath: 'path/file.json', uploadId: 'abc', data: 'chunk', partNumber: 1 })
            ).rejects.toThrow('Not Implemented');
        });
    });

    describe('uploadEmptyFileAsync', () => {
        test('throws Not Implemented', async () => {
            await expect(
                client.uploadEmptyFileAsync({ filePath: 'path/empty.json' })
            ).rejects.toThrow('Not Implemented');
        });
    });

    describe('downloadAsync', () => {
        test('throws Not Implemented', async () => {
            await expect(client.downloadAsync('path/to/file.json')).rejects.toThrow('Not Implemented');
        });
    });

    describe('deleteAsync', () => {
        test('throws Not Implemented', async () => {
            await expect(client.deleteAsync('path/to/file.json')).rejects.toThrow('Not Implemented');
        });
    });

    describe('deleteObjectsAsync', () => {
        test('throws Not Implemented', async () => {
            await expect(
                client.deleteObjectsAsync({ filePaths: ['file1.json', 'file2.json'] })
            ).rejects.toThrow('Not Implemented');
        });
    });

    describe('copyObjectAsync', () => {
        test('throws Not Implemented', async () => {
            await expect(
                client.copyObjectAsync({ sourcePath: 'src/file.json', filePath: 'dest/file.json' })
            ).rejects.toThrow('Not Implemented');
        });
    });

    describe('downloadInBatchAsync', () => {
        test('throws Not Implemented', async () => {
            await expect(
                client.downloadInBatchAsync({ filePaths: ['file1.json', 'file2.json'], batch: 10 })
            ).rejects.toThrow('Not Implemented');
        });
    });

    describe('completeMultiPartUploadAsync', () => {
        test('throws Not Implemented', async () => {
            await expect(
                client.completeMultiPartUploadAsync({
                    filePath: 'path/file.json',
                    uploadId: 'abc',
                    multipartUploadParts: [{ ETag: 'etag1', PartNumber: 1 }]
                })
            ).rejects.toThrow('Not Implemented');
        });
    });

    describe('abortMultiPartUploadAsync', () => {
        test('throws Not Implemented', async () => {
            await expect(
                client.abortMultiPartUploadAsync({ filePath: 'path/file.json', uploadId: 'abc' })
            ).rejects.toThrow('Not Implemented');
        });
    });

    describe('subclass implementation pattern', () => {
        test('can be extended with concrete implementations', () => {
            class ConcreteStorageClient extends CloudStorageClient {
                getPublicFilePath(filePath) {
                    return `https://storage.example.com/${this.bucketName}/${filePath}`;
                }
            }

            const concreteClient = new ConcreteStorageClient({ bucketName: 'my-bucket', region: 'us-west-2' });
            expect(concreteClient.getPublicFilePath('data/file.json'))
                .toBe('https://storage.example.com/my-bucket/data/file.json');
        });

        test('subclass inherits bucketName and region', () => {
            class ConcreteStorageClient extends CloudStorageClient {}

            const concreteClient = new ConcreteStorageClient({ bucketName: 'inherited-bucket', region: 'eu-west-1' });
            expect(concreteClient.bucketName).toBe('inherited-bucket');
            expect(concreteClient.region).toBe('eu-west-1');
        });
    });
});
