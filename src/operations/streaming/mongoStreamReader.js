const {Readable} = require('stream');
const {isTrue} = require('../../utils/isTrue');
const env = require('var');
const {logInfo} = require('../common/logging');
const {RETRIEVE} = require('../../constants').GRIDFS;

// https://thenewstack.io/node-js-readable-streams-explained/
// https://github.com/logdna/tail-file-node/blob/ee0389ba34cb2037de776541f800842bb98df6b3/lib/tail-file.js#L22
// https://2ality.com/2019/11/nodejs-streams-async-iteration.html

class MongoReadableStream extends Readable {
    /**
     * constructor
     * @param {DatabasePartitionedCursor} cursor
     * @param {AbortSignal} signal
     * @param {DatabaseAttachmentManager} databaseAttachmentManager
     * @param {number} highWaterMark
     */
    constructor(
        {
            cursor,
            signal,
            databaseAttachmentManager,
            highWaterMark
        }
    ) {
        super({objectMode: true, highWaterMark: highWaterMark});

        /**
         * @type {DatabasePartitionedCursor}
         */
        this.cursor = cursor;

        /**
         * @type {AbortSignal}
         */
        this.signal = signal;

        /**
         * @type {DatabaseAttachmentManager}
         */
        this.databaseAttachmentManager = databaseAttachmentManager;

        /**
         * @type {boolean}
         */
        this.isFetchingData = false; // Track if data is currently being fetched
    }

    // eslint-disable-next-line no-unused-vars
    async _read(size) {
        // Ensure we are not already fetching data
        if (!this.isFetchingData) {
            this.isFetchingData = true;
            try {
                await this.readAsync(size);
            } catch (error) {
                // Handle any errors that may occur during data retrieval
                this.emit('error', error);
                this.push(null); // Signal the end of the stream
                return;
            }
            this.isFetchingData = false;
        }
    }

    /**
     * @param size
     * @returns {Promise<void>}
     */
    async readAsync(size) {
        let count = 0;
        while (count <= size) {
            if (await this.cursor.hasNext()) {
                if (this.signal.aborted) {
                    if (isTrue(env.LOG_STREAM_STEPS)) {
                        logInfo('mongoStreamReader: aborted', {});
                    }
                    return;
                }
                if (isTrue(env.LOG_STREAM_STEPS)) {
                    logInfo('mongoStreamReader: read', {});
                }
                count++;
                /**
                 * element
                 * @type {Resource}
                 */
                let resource = await this.cursor.next();
                if (this.databaseAttachmentManager) {
                    resource = await this.databaseAttachmentManager.transformAttachments(resource, RETRIEVE);
                }
                this.push(resource);
            } else {
                this.push(null);
                return;
            }
        }
    }
}

module.exports = {
    MongoReadableStream
};
