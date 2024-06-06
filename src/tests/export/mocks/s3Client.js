const { S3Client } = require('../../../utils/s3Client');

class MockS3Client extends S3Client {
    async uploadAsync() {
        // do nothing
    }

    async createMultiPartUploadAsync() {
        // do nothing just return a string
        return 'test';
    }

    async uploadPartAsync() {
        // do nothing
    }

    async completeMultiPartUploadAsync() {
        // do nothing
    }

    async abortMultiPartUploadAsync() {
        // do nothing
    }
}

module.exports = { MockS3Client };
