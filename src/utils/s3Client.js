const {
    S3Client: S3,
    PutObjectCommand,
    CreateMultipartUploadCommand,
    UploadPartCommand,
    AbortMultipartUploadCommand,
    CompleteMultipartUploadCommand,
    DeleteObjectCommand,
    GetObjectCommand,
    CopyObjectCommand,
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
     * @property {string} [ifMatch] - when set, performs a conditional write (If-Match on the
     *          object's current ETag); the write succeeds only if the object is unchanged since
     *          that ETag was captured.
     *
     * @param {UploadAsyncParams}
     * @returns {Promise<import('@aws-sdk/client-s3').PutObjectCommandOutput|null>} the raw
     *          PutObject response (callers read `.ETag` when needed), or null when a conditional
     *          `ifMatch` precondition failed (object changed/gone since the ETag was captured).
     */
    async uploadAsync({ filePath, data, ifMatch }) {
        try {
            const params = {
                Bucket: this.bucketName,
                Key: filePath,
                Body: data
            };
            if (ifMatch) {
                params.IfMatch = ifMatch;
            }
            return await this.client.send(new PutObjectCommand(params));
        } catch (err) {
            if (ifMatch && this._isPreconditionFailed(err)) {
                // Object changed since `ifMatch` was captured — caller decides to skip.
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
