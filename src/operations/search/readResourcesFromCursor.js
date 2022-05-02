const {pipeline} = require('stream/promises');
const {prepareResource} = require('../common/resourcePreparer');

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

    /**
     * @type {Readable}
     */
    const stream = cursor.stream();

    // const streamToArray = new StreamToArrayWriter(buffer);

    // https://nodejs.org/docs/latest-v16.x/api/stream.html#streams-compatibility-with-async-generators-and-async-iterators
    await pipeline(
        stream,
        // new ResourcePreparerTransform(user, scope, args, Resource, resourceName),
        async function* (source) {
            for await (const chunk of source) {
                yield await prepareResource(user, scope, args, Resource, chunk, resourceName);
            }
        },
        // streamToArray
        async function* (source) {
            for await (const chunk of source) {
                for (const item1 of chunk) {
                    resources.push(item1);
                }
                yield 1;
            }
        },
    );

    return resources;
}


module.exports = {
    readResourcesFromCursor: readResourcesFromCursor
};
