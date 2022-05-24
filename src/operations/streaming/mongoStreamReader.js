const {Readable} = require('stream');
const env = require('var');
const {isTrue} = require('../../utils/isTrue');

// https://thenewstack.io/node-js-readable-streams-explained/
// https://github.com/logdna/tail-file-node/blob/ee0389ba34cb2037de776541f800842bb98df6b3/lib/tail-file.js#L22
// https://2ality.com/2019/11/nodejs-streams-async-iteration.html
class MongoStreamReader extends Readable {
    /**
     * @param {import('mongodb').Cursor<import('mongodb').WithId<import('mongodb').Document>>} cursor
     **/
    constructor(cursor) {
        super({objectMode: true});
        /**
         * @type {import('mongodb').Cursor<import('mongodb').WithId<import('mongodb').Document>>}
         */
        this.cursor = cursor;
    }

    async _readChunks(cursor) {
        for await (const doc of cursor) {
            if (!this.push(doc)) {
                return;
            }
        }
        this.quit();
    }

    quit() {
        this.push(null); // signal end of stream

        process.nextTick(() => {
            if (this._readableState && !this._readableState.endEmitted) {
                // 'end' is not emitted unless data is flowing, but this makes
                // confusing inconsistencies, so emit it all the time
                this.emit('end');
            }
        });
    }

    // eslint-disable-next-line no-unused-vars
    _read(size) {
        this._readChunks(this.cursor);
    }

}

/**
 * Async generator for reading from Mongo
 * @param {import('mongodb').Cursor<import('mongodb').WithId<import('mongodb').Document>>} cursor
 * @param {AbortSignal} signal
 * @returns {AsyncGenerator<*, Resource, *>}
 */
async function* readMongoStreamGenerator(cursor, signal) {
    try {
        // let chunk_number = 0;
        while (await cursor.hasNext()) {
            // logDebug(user, `Buffered count=${cursor.bufferedCount()}`);
            // chunk_number += 1;
            // console.log(`read: chunk:${chunk_number}`);
            if (signal.aborted) {
                if (isTrue(env.LOG_STREAM_STEPS)) {
                    console.log('mongoStreamReader: aborted');
                }
                return;
            }
            if (isTrue(env.LOG_STREAM_STEPS)) {
                console.log('mongoStreamReader: read');
            }
            /**
             * element
             * @type {Resource}
             */
            yield await cursor.next();
        }
    } catch (e) {
        console.log('mongoStreamReader: error' + e.toString());
        throw e;
    }
}

// https://nodejs.org/docs/latest-v16.x/api/stream.html#streams-compatibility-with-async-generators-and-async-iterators
/**
 * Creates a readable mongo stream from cursor
 * @param {import('mongodb').Cursor<import('mongodb').WithId<import('mongodb').Document>>} cursor
 * @param {AbortSignal} signal
 * @returns {import('stream').Readable}
 */
const createReadableMongoStream = (cursor, signal) => Readable.from(
    readMongoStreamGenerator(cursor, signal)
);


module.exports = {
    MongoStreamReader: MongoStreamReader,
    createReadableMongoStream: createReadableMongoStream
};
