/**
 * Store information about the multi part for each resource type
 */
class S3MultiPartContext {
    /**
     * class that holds info about s3 multi part upload
     * @param {string | null} uploadId
     * @param {number} readCount
     * @param {number} currentPartNumber
     * @param {string | null} resourceFilePath
     * @param {string | null} collection
     * @param {[]} multipartUploadParts
     */
    constructor (
        {
            uploadId,
            readCount,
            currentPartNumber,
            resourceFilePath,
            collection,
            multipartUploadParts
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
         * @type {number}
         */
        this.currentPartNumber = currentPartNumber || 1;
        /**
         * @type {string|null}
         */
        this.resourceFilePath = resourceFilePath;
        /**
         * @type {string|null}
         */
        this.collection = collection;

        this.multipartUploadParts = multipartUploadParts || [];
    }
}

module.exports = {
    S3MultiPartContext
};
