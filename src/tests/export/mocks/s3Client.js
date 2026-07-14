const { S3Client } = require('../../../utils/s3Client');

class MockS3Client extends S3Client {
    uploadedData = {}

    // Records every copyObjectAsync target key so tests can assert TTL-refresh (touch) calls.
    copyCalls = []

    uploadAsync({ filePath, data, ifNoneMatch }) {
        if (ifNoneMatch && this.uploadedData[filePath] !== undefined) {
            // Conditional create precondition failed — the key already exists.
            return null;
        }
        this.uploadedData[filePath] = data.toString('utf-8');
        // Mirror the S3 PutObject response shape (a truthy object; callers only check for non-null).
        return { ETag: '"mock-etag"' };
    }

    async existsAsync(filePath) {
        return this.uploadedData[filePath] !== undefined;
    }

    async copyObjectAsync({ sourcePath, filePath }) {
        this.copyCalls.push(filePath);
        if (this.uploadedData[sourcePath] === undefined) {
            // Source object is gone (simulates a TTL-expired history object).
            return false;
        }
        this.uploadedData[filePath] = this.uploadedData[sourcePath];
        return true;
    }

    async createMultiPartUploadAsync() {
        // do nothing just return a string
        return 'test';
    }

    async uploadPartAsync() {
        // do nothing
    }

    async uploadEmptyFileAsync() {
        // do nothing
    }

    async completeMultiPartUploadAsync() {
        // do nothing
    }

    async abortMultiPartUploadAsync() {
        // do nothing
    }

    downloadInBatchAsync({ filePaths, batch }){
        let result = {}
        filePaths.forEach(path => {
            if(this.uploadedData[path]){
                result[path] = this.uploadedData[path];
            }
        });
        return result;
    }

    downloadAsync( filePaths ){
        if(this.uploadedData[filePaths]){
            return this.uploadedData[filePaths];
        }
        return null;
    }

    async deleteAsync(filePath) {
        delete this.uploadedData[filePath];
    }
}

module.exports = { MockS3Client };
