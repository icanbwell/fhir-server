const {
    S3Client: S3,
    PutObjectCommand,
    CreateMultipartUploadCommand,
    UploadPartCommand,
    AbortMultipartUploadCommand,
    CompleteMultipartUploadCommand,
    GetObjectCommand,
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
     *
     * @param {ConstructorParams}
     */
    constructor({ bucketName, region }) {
        super({
            bucketName,
            region
        });

        /**
         * @type {S3}
         */
        this.client = new S3({ region });
    }

    /**
     * Converts the filePath passed into s3 url
     * @param {string} filePath
     */
    getPublicFilePath(filePath) {
        return `s3://${this.bucketName}/${filePath}`;
    }

    /**
     * Upload the data passed to s3
     * @typedef {Object} UploadAsyncParams
     * @property {string} filePath
     * @property {string} data
     *
     * @param {UploadAsyncParams}
     */
    async uploadAsync({ filePath, data }) {
        try {
            await this.client.send(
                new PutObjectCommand({
                    Bucket: this.bucketName,
                    Key: filePath,
                    Body: data
                })
            );
        } catch (err) {
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
     * Upload files in parallel to s3 in given batch size
     * @typedef {Object} uploadInBatchAsyncParams
     * @property {{filePath: string, data: Buffer}[]} fileDataWithPath
     * @property {number} batch
     *
     * @param {uploadInBatchAsyncParams}
     */
    async uploadInBatchAsync({ fileDataWithPath, batch }) {
        try {
            for (let i = 0; i < fileDataWithPath.length; i += batch) {
                const batchFiles = fileDataWithPath.slice(i, i + batch);

                const uploadPromises = batchFiles.map(async (file) => {
                    return new Upload({
                        client: this.client,
                        params: {
                            Bucket: this.bucketName,
                            Key: file.filePath,
                            Body: file.data
                        }
                    }).done().catch((error) => {
                        logError(`Error in uploading file to S3 at: ${file.filePath}`, {error})
                    });
                });
                await Promise.all(uploadPromises);
            }
        } catch (err) {
            throw new RethrownError({
                message: `Error in uploadInBatchAsync: ${err.message}`,
                error: err,
                source: 'S3Client'
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
