const { S3NdjsonReader } = require('../../operations/asyncJobs/bulkImport/s3NdjsonReader');

class MockS3NdjsonReader extends S3NdjsonReader {
    constructor({ configManager }) {
        super({ configManager });
        this.readCalls = [];
        this.writeCalls = [];
        /**
         * @type {Array<Object>}
         */
        this.linesToYield = [];
    }

    /**
     * Configures the resources this mock will yield on the next readNdjsonAsync() call
     * @param {Array<Object>} resources
     */
    setLinesToYield(resources) {
        this.linesToYield = resources;
    }

    async *readNdjsonAsync({ filepath, byteRangeStart, byteRangeEnd, fileSize }) {
        this.readCalls.push({ filepath, byteRangeStart, byteRangeEnd, fileSize });
        for (let i = 0; i < this.linesToYield.length; i++) {
            // byteOffset is arbitrary here (this mock doesn't read real bytes) but must be
            // distinct per line and independent of byteRangeStart to mirror the real
            // reader's guarantee that it's a stable, range-independent identifier.
            yield { lineNumber: i + 1, byteOffset: i * 100, resource: this.linesToYield[i] };
        }
    }

    getReadCalls() {
        return this.readCalls;
    }

    async writeNdjsonAsync({ filepath, data }) {
        this.writeCalls.push({ filepath, data });
    }

    getWriteCalls() {
        return this.writeCalls;
    }

    clear() {
        this.readCalls = [];
        this.writeCalls = [];
        this.linesToYield = [];
    }
}

module.exports = { MockS3NdjsonReader };
