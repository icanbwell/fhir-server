const {pipeline} = require('stream/promises');
const {prepareResourceAsync} = require('../common/resourcePreparer');
const {logError} = require('../common/logging');


/**
 * Reads resources from Mongo cursor
 * @param {import('mongodb').FindCursor<import('mongodb').WithId<Document>>} cursor
 * @param {string | null} user
 * @param {string | null} scope
 * @param {Object?} args
 * @param {Function} Resource
 * @param {string} resourceName
 * @returns {Promise<Resource[]>}
 */
async function readResourcesFromCursorAsync(cursor, user, scope, args, Resource, resourceName) {
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

    try {
        // https://mongodb.github.io/node-mongodb-native/4.5/classes/FindCursor.html
        // https://nodejs.org/docs/latest-v16.x/api/stream.html#streams-compatibility-with-async-generators-and-async-iterators
        // https://nodejs.org/docs/latest-v16.x/api/stream.html#additional-notes
        await pipeline(
            // cursorStream,
            async function* () {
                // let chunk_number = 0;
                while (await cursor.hasNext()) {
                    // logDebug(user, `Buffered count=${cursor.bufferedCount()}`);
                    // chunk_number += 1;
                    // console.log(`read: chunk:${chunk_number}`);
                    /**
                     * element
                     * @type {Resource}
                     */
                    yield await cursor.next();
                }
            },
            async function* (source) {
                // let chunk_number = 0;
                for await (const chunk of source) {
                    // chunk_number += 1;
                    // console.log(`prepareResource: chunk:${chunk_number}`);
                    yield await prepareResourceAsync(user, scope, args, Resource, chunk, resourceName);
                }
            },
            // NOTE: do not use an async generator as the last writer otherwise the pipeline will hang
            async function (source) {
                // let chunk_number = 0;
                for await (const chunk of source) {
                    // let item_number = 0;
                    // chunk_number += 1;
                    // console.log(`streamToArray: chunk:${chunk_number}`);
                    for (const item1 of chunk) {
                        // item_number += 1;
                        // console.log(`streamToArray: chunk:${chunk_number}, item:${item_number}`);
                        resources.push(item1);
                    }
                }
            }
        );
    } catch (e) {
        logError(user, e);
        throw e;
    }
    // logDebug(user, 'Done with loading resources');
    return resources;
}


module.exports = {
    readResourcesFromCursorAsync: readResourcesFromCursorAsync
};
