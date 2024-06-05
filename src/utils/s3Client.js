const { S3Client: S3, PutObjectCommand } = require('@aws-sdk/client-s3');
const { Upload } = require('@aws-sdk/lib-storage');
const { RethrownError } = require('./rethrownError');
const { assertIsValid } = require('./assertType');

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
        assertIsValid(bucketName, 'Cannot initialize S3Client without region');

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
        return `https://${this.bucketName}.s3.amazonaws.com/${filePath}`;
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
     * @typedef {Object} StartUploadViaStreamParams
     * @property {string} filePath
     * @property {import('stream').PassThrough} passableStream
     *
     * @param {StartUploadViaStreamParams}
     */
    startUploadViaStream({ filePath, passableStream }) {
        try {
            return new Upload({
                client: this.client,
                params: {
                    Bucket: this.bucketName,
                    Key: filePath,
                    Body: passableStream
                }
            });
        } catch (err) {
            throw new RethrownError({
                message: `Error in startUploadViaStreamAsync: ${err.message}`,
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
