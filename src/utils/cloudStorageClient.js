const { assertIsValid } = require('./assertType');

/**
 * Abstract base class for an CloudStorageClient. Inherit from this to create a new client.
 */
class CloudStorageClient {
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
        assertIsValid(bucketName, 'Cannot initialize storage client without bucketName');

        /**
         * @type {string}
         */
        this.region = region;
        assertIsValid(region, 'Cannot initialize storage client without region');
    }

    /**
     * Converts the filePath passed into public storage url
     * @param {string} filePath
     */
    getPublicFilePath(filePath) {
        throw Error('Not Implemented');
    }

    /**
     * Upload the data passed to cloud storage
     * @typedef {Object} UploadAsyncParams
     * @property {string} filePath
     * @property {string} data
     *
     * @param {UploadAsyncParams}
     */
    async uploadAsync({ filePath, data }) {
        throw Error('Not Implemented');
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
        throw Error('Not Implemented');
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
        throw Error('Not Implemented');
    }

    /**
     * Upload an empty file to cloud storage
     * @typedef {Object} UploadEmptyFileAsyncParams
     * @property {string} filePath
     *
     * @param {UploadEmptyFileAsyncParams}
     */
    async uploadEmptyFileAsync({ filePath }) {
        throw Error('Not Implemented');
    }

    /**
     * Download file from cloud storage for provided path
     * @param {string} filePath
     * @returns {object|null}
     */
    async downloadAsync(filePath) {
        throw Error('Not Implemented');

    }

    /**
     * Download files in parallel from cloud storage in given batch size for provided paths
     * @typedef {Object} downloadInBatchAsyncParams
     * @property {string[]} filePaths
     * @property {number} batch
     *
     * @param {downloadInBatchAsyncParams}
     * @returns {object}
     */
    async downloadInBatchAsync({ filePaths, batch }) {
        throw Error('Not Implemented');
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
        throw Error('Not Implemented');
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
        throw Error('Not Implemented');
    }
}

module.exports = { CloudStorageClient };
