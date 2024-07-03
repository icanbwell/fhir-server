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
     * @param {number | null} averageDocumentSize
     * @param {[]} multipartUploadParts
     */
    constructor (
        {
            uploadId,
            readCount,
            resourceFilePath,
            collection,
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
         * @type {number|null}
         */
        this.averageDocumentSize = averageDocumentSize;

        this.multipartUploadParts = multipartUploadParts || [];
    }
}

module.exports = {
    S3MultiPartContext
};
