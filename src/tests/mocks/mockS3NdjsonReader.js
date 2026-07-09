const { S3NdjsonReader } = require('../../operations/import/s3NdjsonReader');

class MockS3NdjsonReader extends S3NdjsonReader {
    constructor({ configManager }) {
        super({ configManager });
        this.readCalls = [];
    }

    async *readNdjsonAsync({ filepath, byteRangeStart, byteRangeEnd, fileSize }) {
        this.readCalls.push({ filepath, byteRangeStart, byteRangeEnd, fileSize });
        yield* [];
    }

    getReadCalls() {
        return this.readCalls;
    }

    clear() {
        this.readCalls = [];
    }
}

module.exports = { MockS3NdjsonReader };
