const { describe, test, expect, beforeEach, jest } = require('@jest/globals');

// Mock dependencies before requiring the module
jest.mock('@aws-sdk/client-s3', () => {
    class NoSuchKey extends Error {
        constructor(message) {
            super(message || 'NoSuchKey');
            this.name = 'NoSuchKey';
        }
    }
    return {
        S3Client: jest.fn().mockImplementation(() => ({
            send: jest.fn()
        })),
        PutObjectCommand: jest.fn().mockImplementation((params) => ({ _params: params, _type: 'PutObject' })),
        CreateMultipartUploadCommand: jest.fn().mockImplementation((params) => ({ _params: params, _type: 'CreateMultipartUpload' })),
        UploadPartCommand: jest.fn().mockImplementation((params) => ({ _params: params, _type: 'UploadPart' })),
        AbortMultipartUploadCommand: jest.fn().mockImplementation((params) => ({ _params: params, _type: 'AbortMultipartUpload' })),
        CompleteMultipartUploadCommand: jest.fn().mockImplementation((params) => ({ _params: params, _type: 'CompleteMultipartUpload' })),
        DeleteObjectCommand: jest.fn().mockImplementation((params) => ({ _params: params, _type: 'DeleteObject' })),
        GetObjectCommand: jest.fn().mockImplementation((params) => ({ _params: params, _type: 'GetObject' })),
        CopyObjectCommand: jest.fn().mockImplementation((params) => ({ _params: params, _type: 'CopyObject' })),
        HeadObjectCommand: jest.fn().mockImplementation((params) => ({ _params: params, _type: 'HeadObject' })),
        NoSuchKey
    };
});

jest.mock('@aws-sdk/lib-storage', () => ({
    Upload: jest.fn().mockImplementation(() => ({
        done: jest.fn().mockResolvedValue(undefined)
    }))
}));

jest.mock('../../../utils/rethrownError', () => ({
    RethrownError: class RethrownError extends Error {
        constructor({ message, error, source, args }) {
            super(message);
            this.originalError = error;
            this.source = source;
            this.args = args;
        }
    }
}));

jest.mock('../../../utils/assertType', () => ({
    assertIsValid: jest.fn((val, msg) => {
        if (!val) { throw new Error(msg); }
    }),
    assertTypeEquals: jest.fn()
}));

jest.mock('../../../operations/common/logging', () => ({
    logError: jest.fn(),
    logInfo: jest.fn(),
    logDebug: jest.fn()
}));

const { S3Client } = require('../../../utils/s3Client');
const { NoSuchKey } = require('@aws-sdk/client-s3');

describe('S3Client', () => {
    let s3Client;
    let mockSend;

    beforeEach(() => {
        jest.clearAllMocks();
        s3Client = new S3Client({
            bucketName: 'test-bucket',
            region: 'us-east-1'
        });
        mockSend = s3Client.client.send;
    });

    describe('downloadAsync - null Body bug', () => {
        // EXPECTED: correct behavior (will fail until bug is fixed)
        test('should return null when response.Body is null', async () => {
            // S3 GetObject can return a response with Body=null in edge cases
            // (e.g., zero-byte objects in certain S3 configurations, or mocked responses)
            mockSend.mockResolvedValue({ Body: null });

            // Should handle null Body gracefully and return null
            const result = await s3Client.downloadAsync('some/path');
            expect(result).toBeNull();
        });

        // EXPECTED: correct behavior (will fail until bug is fixed)
        test('should return null when response.Body is undefined', async () => {
            // Response with no Body property at all
            mockSend.mockResolvedValue({});

            // Should handle undefined Body gracefully and return null
            const result = await s3Client.downloadAsync('some/path');
            expect(result).toBeNull();
        });

        test('downloadAsync handles NoSuchKey error by returning null', async () => {
            mockSend.mockRejectedValue(new NoSuchKey('Key not found'));

            const result = await s3Client.downloadAsync('missing/key');
            expect(result).toBeNull();
        });

        test('downloadAsync works with valid response Body', async () => {
            mockSend.mockResolvedValue({
                Body: { transformToString: jest.fn().mockResolvedValue('file content') }
            });

            const result = await s3Client.downloadAsync('valid/path');
            expect(result).toBe('file content');
        });
    });

    describe('downloadInBatchAsync - null Body bug', () => {
        // EXPECTED: correct behavior (will fail until bug is fixed)
        test('should handle null Body in batch download gracefully', async () => {
            // First call returns valid Body, second returns null Body
            mockSend
                .mockResolvedValueOnce({
                    Body: { transformToString: jest.fn().mockResolvedValue('content1') }
                })
                .mockResolvedValueOnce({ Body: null });

            // Should handle null Body gracefully, returning null for that entry
            const results = await s3Client.downloadInBatchAsync({
                filePaths: ['path1', 'path2'],
                batch: 5
            });
            expect(results['path1']).toBe('content1');
            expect(results['path2']).toBeNull();
        });
    });

    describe('createMultiPartUploadAsync - undefined return value', () => {
        test('BUG: returns undefined when all retries yield no UploadId', async () => {
            // S3 returns response without UploadId for all 3 retries
            mockSend
                .mockResolvedValueOnce({ UploadId: undefined })
                .mockResolvedValueOnce({ UploadId: null })
                .mockResolvedValueOnce({ UploadId: '' });

            const result = await s3Client.createMultiPartUploadAsync({ filePath: 'test/file.json' });

            // BUG: Function returns undefined (falls through) instead of throwing an error.
            // Caller will try to use undefined as uploadId in uploadPartAsync,
            // which passes assertIsValid check but sends undefined to S3.
            expect(result).toBeUndefined();
        });

        test('createMultiPartUploadAsync returns uploadId on first success', async () => {
            mockSend.mockResolvedValueOnce({ UploadId: 'upload-123' });

            const result = await s3Client.createMultiPartUploadAsync({ filePath: 'test/file.json' });
            expect(result).toBe('upload-123');
        });

        test('createMultiPartUploadAsync returns uploadId on retry success', async () => {
            mockSend
                .mockResolvedValueOnce({ UploadId: undefined })
                .mockResolvedValueOnce({ UploadId: 'upload-456' });

            const result = await s3Client.createMultiPartUploadAsync({ filePath: 'test/file.json' });
            expect(result).toBe('upload-456');
        });

        test('createMultiPartUploadAsync throws when filePath is empty', async () => {
            await expect(
                s3Client.createMultiPartUploadAsync({ filePath: '' })
            ).rejects.toThrow('Cannot start multi-part upload without a filePath');
        });
    });

    describe('uploadAsync - conditional create (ifNoneMatch)', () => {
        test('returns null when precondition fails (key exists)', async () => {
            const preconditionError = new Error('PreconditionFailed');
            preconditionError.name = 'PreconditionFailed';
            mockSend.mockRejectedValue(preconditionError);

            const result = await s3Client.uploadAsync({
                filePath: 'existing/key',
                data: 'test',
                ifNoneMatch: true
            });
            expect(result).toBeNull();
        });

        test('throws RethrownError for non-precondition errors with ifNoneMatch', async () => {
            const networkError = new Error('Network timeout');
            networkError.name = 'TimeoutError';
            mockSend.mockRejectedValue(networkError);

            await expect(
                s3Client.uploadAsync({
                    filePath: 'some/path',
                    data: 'test',
                    ifNoneMatch: true
                })
            ).rejects.toThrow('Error in uploadAsync');
        });
    });

    describe('existsAsync - error handling', () => {
        test('returns true when object exists', async () => {
            mockSend.mockResolvedValue({});
            const result = await s3Client.existsAsync('existing/path');
            expect(result).toBe(true);
        });

        test('returns false for 404 (NotFound)', async () => {
            const notFoundErr = new Error('Not Found');
            notFoundErr.name = 'NotFound';
            mockSend.mockRejectedValue(notFoundErr);

            const result = await s3Client.existsAsync('missing/path');
            expect(result).toBe(false);
        });

        test('returns false for httpStatusCode 404', async () => {
            const err = new Error('Not Found');
            err.$metadata = { httpStatusCode: 404 };
            mockSend.mockRejectedValue(err);

            const result = await s3Client.existsAsync('missing/path');
            expect(result).toBe(false);
        });

        test('throws for non-404 errors', async () => {
            const err = new Error('Access Denied');
            err.name = 'AccessDenied';
            err.$metadata = { httpStatusCode: 403 };
            mockSend.mockRejectedValue(err);

            await expect(s3Client.existsAsync('forbidden/path'))
                .rejects.toThrow('Error in existsAsync');
        });
    });

    describe('copyObjectAsync - error handling', () => {
        test('returns true on success', async () => {
            mockSend.mockResolvedValue({});
            const result = await s3Client.copyObjectAsync({
                sourcePath: 'source/file',
                filePath: 'dest/file'
            });
            expect(result).toBe(true);
        });

        test('returns false when source key does not exist (NoSuchKey instance)', async () => {
            mockSend.mockRejectedValue(new NoSuchKey('Key not found'));
            const result = await s3Client.copyObjectAsync({
                sourcePath: 'missing/source',
                filePath: 'dest/file'
            });
            expect(result).toBe(false);
        });

        test('returns false when source key does not exist (name=NoSuchKey)', async () => {
            const err = new Error('No Such Key');
            err.name = 'NoSuchKey';
            mockSend.mockRejectedValue(err);
            const result = await s3Client.copyObjectAsync({
                sourcePath: 'missing/source',
                filePath: 'dest/file'
            });
            expect(result).toBe(false);
        });
    });

    describe('uploadPartAsync', () => {
        test('returns ETag and PartNumber on success', async () => {
            mockSend.mockResolvedValue({ ETag: '"abc123"' });

            const result = await s3Client.uploadPartAsync({
                filePath: 'test/file',
                uploadId: 'upload-1',
                data: 'chunk-data',
                partNumber: 1
            });

            expect(result).toEqual({ ETag: '"abc123"', PartNumber: 1 });
        });

        test('throws when filePath is empty', async () => {
            await expect(
                s3Client.uploadPartAsync({
                    filePath: '',
                    uploadId: 'upload-1',
                    data: 'data',
                    partNumber: 1
                })
            ).rejects.toThrow('Cannot upload without filePath');
        });

        test('throws when uploadId is empty', async () => {
            await expect(
                s3Client.uploadPartAsync({
                    filePath: 'file',
                    uploadId: '',
                    data: 'data',
                    partNumber: 1
                })
            ).rejects.toThrow('UploadId is required to upload part of a file');
        });
    });
});
