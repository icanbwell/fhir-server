const {Readable} = require('stream');
const env = require('var');
const {isTrue} = require('../../utils/isTrue');

// https://thenewstack.io/node-js-readable-streams-explained/
// https://github.com/logdna/tail-file-node/blob/ee0389ba34cb2037de776541f800842bb98df6b3/lib/tail-file.js#L22
// https://2ality.com/2019/11/nodejs-streams-async-iteration.html

/**
 * Async generator for reading from Mongo
 * @param {DatabasePartitionedCursor} cursor
 * @param {AbortSignal} signal
 * @returns {AsyncGenerator<*, Resource, *>}
 */
async function* readMongoStreamGenerator({cursor, signal}) {
    try {
        while (await cursor.hasNext()) {
            if (signal.aborted) {
                if (isTrue(env.LOG_STREAM_STEPS)) {
                    console.log(JSON.stringify({message: 'mongoStreamReader: aborted'}));
                }
                return;
            }
            if (isTrue(env.LOG_STREAM_STEPS)) {
                console.log(JSON.stringify({message: 'mongoStreamReader: read'}));
            }
            /**
             * element
             * @type {Resource}
             */
            yield await cursor.next();
        }
    } catch (e) {
        console.log(JSON.stringify({message: 'mongoStreamReader: error' + e.toString()}));
        throw new AggregateError([e], 'mongoStreamReader: error');
    }
}

// https://nodejs.org/docs/latest-v16.x/api/stream.html#streams-compatibility-with-async-generators-and-async-iterators
/**
 * Creates a readable mongo stream from cursor
 * @param {DatabasePartitionedCursor} cursor
 * @param {AbortSignal} signal
 * @returns {import('stream').Readable}
 */
const createReadableMongoStream = ({cursor, signal}) => Readable.from(
    readMongoStreamGenerator({cursor, signal})
);


module.exports = {
    createReadableMongoStream
};
