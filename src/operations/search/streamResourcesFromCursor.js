const {pipeline} = require('stream/promises');
const {prepareResource} = require('../common/resourcePreparer');
const JSONStream = require('JSONStream');
const env = require('var');

/**
 * Reads resources from Mongo cursor
 * @param {import('mongodb').FindCursor<import('mongodb').WithId<Document>>} cursor
 * @param {import('http').ServerResponse} res
 * @param {string | null} user
 * @param {string | null} scope
 * @param {Object?} args
 * @param {function (Object): Resource} Resource
 * @param {string} resourceName
 * @returns {Promise<void>}
 */
async function streamResourcesFromCursor(cursor, res, user, scope,
                                         args, Resource, resourceName) {
    /**
     * @type {Readable}
     */
    const stream = cursor.stream();

    let openJson = '[';
    let closeJson = ']';

    const createBundle = env.RETURN_BUNDLE || args['_bundle'];
    if (createBundle) {
        openJson = '{"resourceType":"Bundle", "total": 0, "type": "searchset", "entry":[';
        closeJson = ']}';
    }

    // https://nodejs.org/docs/latest-v16.x/api/stream.html#streams-compatibility-with-async-generators-and-async-iterators
    await pipeline(
        stream,
        // new ResourcePreparerTransform(user, scope, args, Resource, resourceName),
        async function* (source) {
            for await (const chunk of source) {
                /**
                 * @type {Resource[]}
                 */
                const resources = await prepareResource(user, scope, args, Resource, chunk, resourceName);
                if (resources.length > 0) {
                    yield createBundle ? {resource: resources[0]} : resources[0];
                } else {
                    yield null;
                }
            }
        },
        // https://www.npmjs.com/package/JSONStream
        JSONStream.stringify(openJson, ',', closeJson),
        res.type('application/fhir+json')
    );
}


module.exports = {
    streamResourcesFromCursor: streamResourcesFromCursor
};
