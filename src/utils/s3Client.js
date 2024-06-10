const { S3Client: S3, PutObjectCommand, CreateMultipartUploadCommand, UploadPartCommand, AbortMultipartUploadCommand, CompleteMultipartUploadCommand } = require('@aws-sdk/client-s3');
const { RethrownError } = require('./rethrownError');
const { assertIsValid } = require('./assertType');
const { logError } = require('../operations/common/logging');

class S3Client {
    /**
     * @typedef {Object} ConstructorParams
     * @property {string} bucketName
     * @property {string} region
     *
     * @param {ConstructorParams}
     */
    constructor({ bucketName, region }) {
        /**
         * @type {string}
         */
        this.bucketName = bucketName;
        assertIsValid(bucketName, 'Cannot initialize S3Client without bucketName');

        /**
         * @type {string}
         */
        this.region = region;
        assertIsValid(region, 'Cannot initialize S3Client without region');

        /**
         * @type {S3}
         */
        this.client = new S3({ region });
    }

    /**
     * Converts the filePath passed into s3 url
     * @param {string} filePath
     */
    getPublicS3FilePath(filePath) {
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
            })
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
