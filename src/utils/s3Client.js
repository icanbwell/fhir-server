const {
    S3Client: S3,
    PutObjectCommand,
    CreateMultipartUploadCommand,
    UploadPartCommand,
    AbortMultipartUploadCommand,
    CompleteMultipartUploadCommand,
    DeleteObjectCommand,
    DeleteObjectsCommand,
    GetObjectCommand,
    CopyObjectCommand,
    HeadObjectCommand,
    ListObjectsV2Command,
    NoSuchKey
} = require('@aws-sdk/client-s3');
const { Upload } = require('@aws-sdk/lib-storage');
const { RethrownError } = require('./rethrownError');
const { assertIsValid } = require('./assertType');
const { logError } = require('../operations/common/logging');
const { CloudStorageClient } = require('./cloudStorageClient');

class S3Client extends CloudStorageClient {
    /**
     * @typedef {Object} ConstructorParams
     * @property {string} bucketName
     * @property {string} region
     * @property {object} config
     *
     * @param {ConstructorParams}
     */
    constructor({ bucketName, region, config = {} }) {
        super({
            bucketName,
            region
        });

        /**
         * @type {S3}
         */
        this.client = new S3({
            region,
            ...config
        });
    }

    /**
     * Converts the filePath passed into s3 url
     * @param {string} filePath
     */
    getPublicFilePath(filePath) {
        return `s3://${this.bucketName}/${filePath}`;
    }

    /**
     * Upload the data passed to s3.
     * @typedef {Object} UploadAsyncParams
     * @property {string} filePath
     * @property {string|Buffer} data
     * @property {boolean} [ifNoneMatch] - when truthy, performs a conditional create
     *          (If-None-Match: '*'); the write succeeds only if the key does not already exist.
     *
     * @param {UploadAsyncParams}
     * @returns {Promise<import('@aws-sdk/client-s3').PutObjectCommandOutput|null>} the raw
     *          PutObject response, or null when a conditional `ifNoneMatch` precondition failed
     *          (the key already existed for a conditional create).
     */
    async uploadAsync({ filePath, data, ifNoneMatch }) {
        try {
            const params = {
                Bucket: this.bucketName,
                Key: filePath,
                Body: data
            };
            if (ifNoneMatch) {
                params.IfNoneMatch = '*';
            }
            return await this.client.send(new PutObjectCommand(params));
        } catch (err) {
            if (ifNoneMatch && this._isPreconditionFailed(err)) {
                // The key already exists — caller retries with a different key.
                return null;
            }
            throw new RethrownError({
                message: `Error in uploadAsync: ${err.message}`,
                error: err,
                source: 'S3Client',
                args: {
                    filePath
                }
            });
        }
    }

    /**
     * Whether an S3 error is a failed conditional (If-Match/If-None-Match) precondition (HTTP 412).
     * @param {Error} err
     * @returns {boolean}
     * @private
     */
    _isPreconditionFailed(err) {
        return err?.name === 'PreconditionFailed' || err?.$metadata?.httpStatusCode === 412;
    }

    /**
     * Whether an object exists at the given path. Cheap existence probe — no body is transferred.
     * @param {string} filePath
     * @returns {Promise<boolean>}
     */
    async existsAsync(filePath) {
        try {
            await this.client.send(
                new HeadObjectCommand({ Bucket: this.bucketName, Key: filePath })
            );
            return true;
        } catch (err) {
            if (err?.name === 'NotFound' || err?.$metadata?.httpStatusCode === 404) {
                return false;
            }
            throw new RethrownError({
                message: `Error in existsAsync: ${err.message}`,
                error: err,
                source: 'S3Client',
                args: { filePath }
            });
        }
    }

    /**
     * List every object key under a prefix, paginating through `ListObjectsV2` until the provider
     * reports `IsTruncated: false`.
     * @typedef {Object} ListObjectsAsyncParams
     * @property {string} prefix
     *
     * @param {ListObjectsAsyncParams}
     * @returns {Promise<string[]>} every object key under `prefix`, across all pages.
     */
    async listObjectsAsync({ prefix }) {
        const keys = [];
        let continuationToken;
        try {
            do {
                const response = await this.client.send(
                    new ListObjectsV2Command({
                        Bucket: this.bucketName,
                        Prefix: prefix,
                        ContinuationToken: continuationToken
                    })
                );
                for (const object of response.Contents ?? []) {
                    keys.push(object.Key);
                }
                continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined;
            } while (continuationToken);
            return keys;
        } catch (err) {
            throw new RethrownError({
                message: `Error in listObjectsAsync: ${err.message}`,
                error: err,
                source: 'S3Client',
                args: { prefix }
            });
        }
    }

    /**
     * Download file from s3 for provided path
     * @param {string} filePath
     * @returns {object|null}
     */
    async downloadAsync(filePath) {
        try {
            const response = await this.client.send(
                new GetObjectCommand({
                    Bucket: this.bucketName,
                    Key: filePath
                })
            );
            return await response.Body.transformToString();
        } catch (err) {
            if (err instanceof NoSuchKey) {
                logError(`No file found for path: ${filePath}`, { err });
                return null;
            }
            throw new RethrownError({
                message: `Error in downloadAsync: ${err.message}`,
                error: err,
                source: 'S3Client'
            });
        }
    }

    /**
     * Delete file from s3 at the provided path. Idempotent: deleting a non-existent
     * key returns a 204 from S3 (no NoSuchKey thrown), so this method completes silently.
     * @param {string} filePath
     */
    async deleteAsync(filePath) {
        try {
            await this.client.send(
                new DeleteObjectCommand({
                    Bucket: this.bucketName,
                    Key: filePath
                })
            );
        } catch (err) {
            throw new RethrownError({
                message: `Error in deleteAsync: ${err.message}`,
                error: err,
                source: 'S3Client',
                args: {
                    filePath
                }
            });
        }
    }

    /**
     * Batch-delete keys via S3's DeleteObjects, chunking at 1000 keys per call (the API's hard
     * limit). A per-key failure is reported back in `errors` rather than thrown, so one bad key
     * in a chunk never blocks the rest of that chunk or later chunks.
     * @typedef {Object} DeleteObjectsAsyncParams
     * @property {string[]} filePaths
     *
     * @param {DeleteObjectsAsyncParams}
     * @returns {Promise<{deletedKeys: string[], errors: {Key: string, Code?: string, Message?: string}[]}>}
     */
    async deleteObjectsAsync({ filePaths }) {
        if (!filePaths || filePaths.length === 0) {
            return { deletedKeys: [], errors: [] };
        }
        const deletedKeys = [];
        const errors = [];
        const maxKeysPerRequest = 1000; // S3 DeleteObjects hard limit
        try {
            for (let i = 0; i < filePaths.length; i += maxKeysPerRequest) {
                const batchKeys = filePaths.slice(i, i + maxKeysPerRequest);
                const response = await this.client.send(
                    new DeleteObjectsCommand({
                        Bucket: this.bucketName,
                        Delete: {
                            Objects: batchKeys.map((Key) => ({ Key })),
                            Quiet: false
                        }
                    })
                );
                for (const deleted of response.Deleted ?? []) {
                    deletedKeys.push(deleted.Key);
                }
                for (const error of response.Errors ?? []) {
                    errors.push(error);
                }
            }
            return { deletedKeys, errors };
        } catch (err) {
            throw new RethrownError({
                message: `Error in deleteObjectsAsync: ${err.message}`,
                error: err,
                source: 'S3Client',
                args: {
                    filePaths
                }
            });
        }
    }

    /**
     * Copy an object within the bucket. Passing sourcePath === filePath rewrites the
     * object in place with MetadataDirective REPLACE, which resets its Last-Modified
     * timestamp and refreshes the lifecycle-TTL age clock.
     * @typedef {Object} CopyObjectAsyncParams
     * @property {string} sourcePath
     * @property {string} filePath
     *
     * @param {CopyObjectAsyncParams}
     * @returns {Promise<boolean>} true if copied, false if the source object was missing.
     */
    async copyObjectAsync({ sourcePath, filePath }) {
        try {
            await this.client.send(
                new CopyObjectCommand({
                    Bucket: this.bucketName,
                    CopySource: `${this.bucketName}/${sourcePath}`,
                    Key: filePath,
                    MetadataDirective: 'REPLACE'
                })
            );
            return true;
        } catch (err) {
            if (err instanceof NoSuchKey || err.name === 'NoSuchKey') {
                return false;
            }
            throw new RethrownError({
                message: `Error in copyObjectAsync: ${err.message}`,
                error: err,
                source: 'S3Client',
                args: {
                    sourcePath,
                    filePath
                }
            });
        }
    }

    /**
     * Download files in parallel from s3 in given batch size for provided paths
     * @typedef {Object} downloadInBatchAsyncParams
     * @property {string[]} filePaths
     * @property {number} batch
     *
     * @param {downloadInBatchAsyncParams}
     * @returns {object}
     */
    async downloadInBatchAsync({ filePaths, batch }) {
        try {
            const downloadedData = {};
            for (let i = 0; i < filePaths.length; i += batch) {
                const batchPaths = filePaths.slice(i, i + batch);

                const downloadPromises = batchPaths.map(async (path) => {
                    return this.client
                        .send(
                            new GetObjectCommand({
                                Bucket: this.bucketName,
                                Key: path
                            })
                        )
                        .then(async (data) => {
                            downloadedData[path] = await data.Body.transformToString();
                        })
                        .catch((error) => {
                            if (error instanceof NoSuchKey) {
                                logError(`No file found for path: ${path}`, { error });
                            } else {
                                throw new RethrownError({
                                    message: `Error in downloadInBatchAsync: ${error.message}`,
                                    error: error,
                                    source: 'S3Client'
                                });
                            }
                        });
                });
                await Promise.all(downloadPromises);
            }
            return downloadedData;
        } catch (err) {
            throw new RethrownError({
                message: `Error in downloadInBatchAsync: ${err.message}`,
                error: err,
                source: 'S3Client'
            });
        }
    }

    /**
     * Starts a multi-part upload for the file provided
     * @typedef {Object} CreateMultiPartUploadAsyncParams
     * @property {string} filePath
     *
     * @param {CreateMultiPartUploadAsyncParams}
     * @returns {Promise<string|undefined>}
     */
    async createMultiPartUploadAsync({ filePath }) {
        assertIsValid(filePath, 'Cannot start multi-part upload without a filePath');
        try {
            for (let retry = 0; retry < 3; retry++) {
                const { UploadId } = await this.client.send(
                    new CreateMultipartUploadCommand({
                        Bucket: this.bucketName,
                        Key: filePath
                    })
                );

                if (UploadId) {
                    return UploadId;
                }
            }
            logError(`Unable to start multi-part upload for file: ${filePath}`);
        } catch (err) {
            throw new RethrownError({
                message: `Error in createMultiPartUploadAsync: ${err.message}`,
                error: err,
                source: 'S3Client',
                args: {
                    filePath
                }
            })
        }
    }

    /**
     * Upload a part to the multi-part upload for a file
     * @typedef {Object} UploadPartAsyncParams
     * @property {string} filePath
     * @property {string} uploadId
     * @property {string} data
     * @property {number} partNumber
     *
     * @param {UploadPartAsyncParams}
     */
    async uploadPartAsync({ filePath, uploadId, data, partNumber: PartNumber }) {
        assertIsValid(filePath, 'Cannot upload without filePath');
        assertIsValid(uploadId, 'UploadId is required to upload part of a file');
        try {
            const { ETag } = await this.client.send(
                new UploadPartCommand({
                    Bucket: this.bucketName,
                    Key: filePath,
                    UploadId: uploadId,
                    Body: data,
                    PartNumber
                })
            );

            return {
                ETag,
                PartNumber
            };
        } catch (err) {
            throw new RethrownError({
                message: `Error in uploadPartAsync: ${err.message}`,
                error: err,
                source: 'S3Client',
                args: {
                    filePath
                }
            })
        }
    }

    /**
     * Upload an empty file to S3
     * @typedef {Object} UploadEmptyFileAsyncParams
     * @property {string} filePath
     *
     * @param {UploadEmptyFileAsyncParams}
     */
    async uploadEmptyFileAsync({ filePath }) {
        assertIsValid(filePath, 'Cannot upload without filePath');
        try {
            const upload = new Upload({
                client: this.client,
                params: {
                    Bucket: this.bucketName,
                    Key: filePath,
                    Body: ''
                }
            });

            await upload.done();
        } catch (err) {
            throw new RethrownError({
                message: `Error in uploadPartAsync: ${err.message}`,
                error: err,
                source: 'S3Client',
                args: {
                    filePath
                }
            })
        }
    }

    /**
     * Completes the multi-part upload
     * @typedef {Object} CompleteMultiPartUploadAsyncParams
     * @property {string} filePath
     * @property {string} uploadId
     * @property {{ ETag: string, PartNumber: number}[]} multipartUploadParts
     *
     * @param {CompleteMultiPartUploadAsyncParams}
     */
    async completeMultiPartUploadAsync({ filePath, uploadId, multipartUploadParts }) {
        assertIsValid(filePath, 'Cannot complete multi-part upload without a filePath');
        assertIsValid(uploadId, 'UploadId is required to complete multi-part upload');
        try {
            await this.client.send(
                new CompleteMultipartUploadCommand({
                    Bucket: this.bucketName,
                    Key: filePath,
                    UploadId: uploadId,
                    MultipartUpload: {
                        Parts: multipartUploadParts
                    }
                })
            );
        } catch (err) {
            throw new RethrownError({
                message: `Error in completeMultiPartUploadAsync: ${err.message}`,
                error: err,
                source: 'S3Client',
                args: {
                    filePath
                }
            })
        }
    }

    /**
     * Aborts the multi-part upload
     * @typedef {Object} AbortMultiPartUploadAsyncParams
     * @property {string} filePath
     * @property {string} uploadId
     *
     * @param {AbortMultiPartUploadAsyncParams}
     */
    async abortMultiPartUploadAsync({ filePath, uploadId }) {
        assertIsValid(filePath, 'Cannot abort multi-part upload without a filePath');
        assertIsValid(uploadId, 'UploadId is required to abort multi-part upload');
        try {
            await this.client.send(
                new AbortMultipartUploadCommand({
                    Bucket: this.bucketName,
                    Key: filePath,
                    UploadId: uploadId
                })
            );
        } catch (err) {
            throw new RethrownError({
                message: `Error in abortMultiPartUploadAsync: ${err.message}`,
                error: err,
                source: 'S3Client',
                args: {
                    filePath
                }
            })
        }
    }
}

module.exports = { S3Client };
