const {pipeline} = require('stream/promises');
const {Transform} = require('stream');
const {logError} = require('../common/logging');
const {createReadableMongoStream} = require('../streaming/mongoStreamReader');
const {ResourcePreparerTransform} = require('../streaming/resourcePreparer');


/**
 * Reads resources from Mongo cursor
 * @param {DatabasePartitionedCursor} cursor
 * @param {string | null} user
 * @param {string | null} scope
 * @param {Object?} args
 * @param {Function} Resource
 * @param {string} resourceName
 * @param {number} batchObjectCount
 * @param {boolean} useAccessIndex
 * @returns {Promise<Resource[]>}
 */
async function readResourcesFromCursorAsync(cursor, user, scope,
                                            args, Resource, resourceName,
                                            batchObjectCount,
                                            useAccessIndex) {
    /**
     * resources to return
     * @type {Resource[]}
     */
    const resources = [];

    // noinspection JSUnresolvedFunction
    /**
     * https://mongodb.github.io/node-mongodb-native/4.5/classes/FindCursor.html#stream
     * https://mongodb.github.io/node-mongodb-native/4.5/interfaces/CursorStreamOptions.html
     * @type {Readable}
     */
    // We do not use the Mongo stream since we can create our own stream below with more control
    // const cursorStream = cursor.stream();

    /**
     * @type {AbortController}
     */
    const ac = new AbortController();

    try {
        // https://mongodb.github.io/node-mongodb-native/4.5/classes/FindCursor.html
        // https://nodejs.org/docs/latest-v16.x/api/stream.html#streams-compatibility-with-async-generators-and-async-iterators
        // https://nodejs.org/docs/latest-v16.x/api/stream.html#additional-notes

        const readableMongoStream = createReadableMongoStream(cursor, ac.signal);
        readableMongoStream.on('close', () => {
            // console.log('Mongo read stream was closed');
            // ac.abort();
        });

        await pipeline(
            readableMongoStream,
            // new ObjectChunker(batchObjectCount),
            new ResourcePreparerTransform(user, scope, args, Resource, resourceName, useAccessIndex, ac.signal),
            // NOTE: do not use an async generator as the last writer otherwise the pipeline will hang
            new Transform({
                writableObjectMode: true,

                transform(chunk, encoding, callback) {
                    if (ac.signal.aborted) {
                        callback();
                        return;
                    }
                    resources.push(chunk);
                    callback();
                }
            }),
        );
    } catch (e) {
        logError(user, e);
        ac.abort();
        throw e;
    }
    // logDebug(user, 'Done with loading resources');
    return resources;
}


module.exports = {
    readResourcesFromCursorAsync
};
