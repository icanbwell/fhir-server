const { S3NdjsonReader } = require('../../../operations/asyncJobs/bulkImport/s3NdjsonReader');

class MockS3NdjsonReader extends S3NdjsonReader {
    constructor({ configManager }) {
        super({ configManager });
        this.readCalls = [];
        this.writeCalls = [];
        /**
         * @type {Array<Object>}
         */
        this.linesToYield = [];
        this.failReadsRemaining = 0;
        this.failAfterYieldingCount = null;
    }

    /**
     * Configures the resources this mock will yield on the next readNdjsonAsync() call
     * @param {Array<Object>} resources
     */
    setLinesToYield(resources) {
        this.linesToYield = resources;
    }

    /**
     * Makes the next `count` calls to readNdjsonAsync() throw before yielding anything,
     * simulating a transient S3/stream failure. Calls after that yield normally.
     * @param {number} count
     */
    setFailNextReads(count) {
        this.failReadsRemaining = count;
    }

    /**
     * Makes readNdjsonAsync() yield the first `n` configured lines normally, then throw
     * before yielding line n+1 -- simulating a stream failure partway through, e.g. after
     * enough lines have already been flushed to Mongo.
     * @param {number} n
     */
    setFailAfterYielding(n) {
        this.failAfterYieldingCount = n;
    }

    async *readNdjsonAsync({ filepath, byteRangeStart, byteRangeEnd, fileSize }) {
        this.readCalls.push({ filepath, byteRangeStart, byteRangeEnd, fileSize });
        if (this.failReadsRemaining > 0) {
            this.failReadsRemaining--;
            throw new Error('Simulated transient S3 read failure');
        }
        for (let i = 0; i < this.linesToYield.length; i++) {
            if (this.failAfterYieldingCount !== null && i === this.failAfterYieldingCount) {
                throw new Error('Simulated mid-stream S3 read failure');
            }
            // byteOffset is arbitrary here (this mock doesn't read real bytes) but must be
            // distinct per line and independent of byteRangeStart to mirror the real
            // reader's guarantee that it's a stable, range-independent identifier.
            const entry = this.linesToYield[i];
            // A { __parseError: 'message' } entry simulates a real reader's per-line
            // skip-and-report behavior (too-large line, malformed JSON) -- see
            // s3NdjsonReader.readNdjsonAsync.
            if (entry && entry.__parseError) {
                yield { lineNumber: i + 1, byteOffset: i * 100, resource: null, parseError: new Error(entry.__parseError) };
                continue;
            }
            yield { lineNumber: i + 1, byteOffset: i * 100, resource: entry, parseError: null };
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
        this.failReadsRemaining = 0;
        this.failAfterYieldingCount = null;
    }
}

module.exports = { MockS3NdjsonReader };
