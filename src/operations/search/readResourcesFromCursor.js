const {pipeline} = require('stream/promises');
const {prepareResource} = require('../common/resourcePreparer');
const {logError, logDebug} = require('../common/logging');

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
async function readResourcesFromCursor(cursor, user, scope, args, Resource, resourceName) {
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
    // const stream = cursor.stream();

    try {
        // https://mongodb.github.io/node-mongodb-native/4.5/classes/FindCursor.html
        // https://nodejs.org/docs/latest-v16.x/api/stream.html#streams-compatibility-with-async-generators-and-async-iterators
        await pipeline(
            async function* () {
                let chunk_number = 0;
                // https://stackoverflow.com/questions/23915967/mongodb-nodejs-native-cursor-closing-prematurely
                while (await cursor.hasNext()) {
                    logDebug(user, `Buffered count=${cursor.bufferedCount()}`);
                    chunk_number += 1;
                    /**
                     * element
                     * @type {Resource}
                     */
                    console.log(`read: chunk:${chunk_number}`);
                    yield await cursor.next();
                }
            },
            // new ResourcePreparerTransform(user, scope, args, Resource, resourceName),
            async function* (source) {
                let chunk_number = 0;
                for await (const chunk of source) {
                    chunk_number += 1;
                    console.log(`prepareResource: chunk:${chunk_number}`);
                    yield await prepareResource(user, scope, args, Resource, chunk, resourceName);
                }
            },
            // streamToArray
            async function* (source) {
                let chunk_number = 0;
                for await (const chunk of source) {
                    chunk_number += 1;
                    let item_number = 0;
                    for (const item1 of chunk) {
                        item_number += 1;
                        console.log(`streamToArray: chunk:${chunk_number}, item:${item_number}`);
                        resources.push(item1);
                    }
                    yield 1;
                }
            },
        );
    } catch (e) {
        logError(user, e);
    }
    return resources;
}


module.exports = {
    readResourcesFromCursor: readResourcesFromCursor
};
