const { S3Client } = require('../../../utils/s3Client');

class MockS3Client extends S3Client {
    uploadedData = {}

    // Per-key ETag, bumped on every write so tests can exercise If-Match conditional revert.
    etags = {}
    _etagSeq = 0

    // Records every copyObjectAsync target key so tests can assert TTL-refresh (touch) calls.
    copyCalls = []

    _nextEtag() {
        this._etagSeq += 1;
        return `"etag-${this._etagSeq}"`;
    }

    uploadAsync({ filePath, data, ifMatch }) {
        if (ifMatch !== undefined && this.etags[filePath] !== ifMatch) {
            // Conditional write precondition failed (object changed / gone since ifMatch).
            return null;
        }
        this.uploadedData[filePath] = data.toString('utf-8');
        const etag = this._nextEtag();
        this.etags[filePath] = etag;
        // Mirror the S3 PutObject response shape (callers read `.ETag`).
        return { ETag: etag };
    }

    async copyObjectAsync({ sourcePath, filePath }) {
        this.copyCalls.push(filePath);
        if (this.uploadedData[sourcePath] === undefined) {
            // Source object is gone (simulates a TTL-expired history object).
            return false;
        }
        this.uploadedData[filePath] = this.uploadedData[sourcePath];
        this.etags[filePath] = this._nextEtag();
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
        delete this.etags[filePath];
    }
}

module.exports = { MockS3Client };
