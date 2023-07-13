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
     */
    constructor({cursor, signal, databaseAttachmentManager}) {
        super({objectMode: true});

        this.cursor = cursor;

        this.signal = signal;

        this.databaseAttachmentManager = databaseAttachmentManager;
    }

    // eslint-disable-next-line no-unused-vars
    _read(size) {
        (async () => {
            await this.readAsync();
            this.push(null);
        })();
    }

    async readAsync() {
        while (await this.cursor.hasNext()) {
            if (this.signal.aborted) {
                if (isTrue(env.LOG_STREAM_STEPS)) {
                    logInfo('mongoStreamReader: aborted', {});
                }
                return;
            }
            if (isTrue(env.LOG_STREAM_STEPS)) {
                logInfo('mongoStreamReader: read', {});
            }
            /**
             * element
             * @type {Resource}
             */
            let resource = await this.cursor.next();
            if (this.databaseAttachmentManager) {
                resource = await this.databaseAttachmentManager.transformAttachments(resource, RETRIEVE);
            }
            this.push(resource);
        }
    }
}

module.exports = {
    MongoReadableStream
};
