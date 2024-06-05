const { S3Client } = require('../../../utils/s3Client');

class MockS3Client extends S3Client {
    async uploadAsync() {
        // do nothing
    }

    startUploadViaStream() {
        // mock the done function
        return {
            done: () => {}
        };
    }
}

module.exports = { MockS3Client };
