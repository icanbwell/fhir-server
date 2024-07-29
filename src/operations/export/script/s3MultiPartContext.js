/**
 * Store information about the multi part for each resource type
 */
class S3MultiPartContext {
    /**
     * class that holds info about s3 multi part upload
     * @param {string | null} uploadId
     * @param {number} readCount
     * @param {string | null} resourceFilePath
     * @param {string | null} collection
     * @param {string[] | null} previousBuffer
     * @param {number | null} previousBatchSize
     * @param {number | null} averageDocumentSize
     * @param {[]} multipartUploadParts
     */
    constructor (
        {
            uploadId,
            readCount,
            resourceFilePath,
            collection,
            previousBuffer,
            previousBatchSize,
            multipartUploadParts,
            averageDocumentSize
        }
    ) {
        /**
         * @type {string|null}
         */
        this.uploadId = uploadId;
        /**
         * @type {number}
         */
        this.readCount = readCount || 0;
        /**
         * @type {string|null}
         */
        this.resourceFilePath = resourceFilePath;
        /**
         * @type {string|null}
         */
        this.collection = collection;
        /**
         * @type {string|null}
         */
        this.previousBuffer = previousBuffer;
        /**
         * @type {number|null}
         */
        this.previousBatchSize = previousBatchSize;
        /**
         * @type {number|null}
         */
        this.averageDocumentSize = averageDocumentSize;

        this.multipartUploadParts = multipartUploadParts || [];
    }
}

module.exports = {
    S3MultiPartContext
};
