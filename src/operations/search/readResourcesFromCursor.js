const {pipeline} = require('stream/promises');
const {prepareResource} = require('../common/resourcePreparer');
const {logError, logDebug} = require('../common/logging');
const stream = require('stream');


class ResourcesWritable extends stream.Writable {
    constructor(options) {
        options = options || {};
        super({objectMode: true});

        this.resources = options.resources;
    }

    _write(chunk, encoding, callback) {
        console.log(`write: chunk:${this.resources.length}`);
        this.resources.push(chunk);
        callback();
    }
}

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
    const cursorStream = cursor.stream();

    try {
        // https://mongodb.github.io/node-mongodb-native/4.5/classes/FindCursor.html
        // https://nodejs.org/docs/latest-v16.x/api/stream.html#streams-compatibility-with-async-generators-and-async-iterators
        // https://nodejs.org/docs/latest-v16.x/api/stream.html#additional-notes
        // const resourcesWritable = new ResourcesWritable({resources: resources});
        await pipeline(
            cursorStream,
            // async function* () {
            //     let chunk_number = 0;
            //     // https://stackoverflow.com/questions/23915967/mongodb-nodejs-native-cursor-closing-prematurely
            //     while (await cursor.hasNext()) {
            //         logDebug(user, `Buffered count=${cursor.bufferedCount()}`);
            //         chunk_number += 1;
            //         /**
            //          * element
            //          * @type {Resource}
            //          */
            //         console.log(`read: chunk:${chunk_number}`);
            //         yield await cursor.next();
            //     }
            // },
            // async function* (source) {
            //     let chunk_number = 0;
            //     for await (const chunk of source) {
            //         chunk_number += 1;
            //         console.log(`prepareResource: chunk:${chunk_number}`);
            //         yield await prepareResource(user, scope, args, Resource, chunk, resourceName);
            //     }
            // },
            // new ResourcePreparerTransform(user, scope, args, Resource, resourceName),
            // async function* (source) {
            //     let chunk_number = 0;
            //     for await (const chunk of source) {
            //         chunk_number += 1;
            //         console.log(`prepareResource: chunk:${chunk_number}`);
            //         yield await prepareResource(user, scope, args, Resource, chunk, resourceName);
            //     }
            // },
            // // streamToArray
            // function (source) {
            //     let chunk_number = 0;
            //     for (const chunk of source) {
            //         chunk_number += 1;
            //         // let item_number = 0;
            //         console.log(`streamToArray: chunk:${chunk_number}`);
            //         // for (const item1 of chunk) {
            //         //     item_number += 1;
            //         //     console.log(`streamToArray: chunk:${chunk_number}, item:${item_number}`);
            //         //     // resources.push(item1);
            //         // }
            //         // yield 1;
            //     }
            // }
            // resourcesWritable
            async function (source) {
                let chunk_number = 0;
                for await (const chunk of source) {
                    chunk_number += 1;
                    console.log(`streamToArray: chunk:${chunk_number}`);
                    resources.push(chunk);
                }
            }
        );
    } catch (e) {
        logError(user, e);
    }
    logDebug(user, 'Done with loading resources');
    return resources;
}


module.exports = {
    readResourcesFromCursor: readResourcesFromCursor
};
