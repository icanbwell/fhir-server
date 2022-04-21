const {pipeline} = require('stream/promises');
const {prepareResource} = require('../common/resourcePreparer');
const JSONStream = require('JSONStream');

/**
 * Reads resources from Mongo cursor
 * @param {import('mongodb').FindCursor<import('mongodb').WithId<Document>>} cursor
 * @param {import('http').ServerResponse} res
 * @param {string | null} user
 * @param {string | null} scope
 * @param {Object?} args
 * @param {function (Object): Resource} Resource
 * @param {string} useJson
 * @param {string} resourceName
 * @param {string} contentType
 * @returns {Promise<void>}
 */
async function streamResourcesFromCursor(cursor, res, user, scope,
                                         args,
                                         Resource,
                                         resourceName,
                                         contentType = 'application/fhir+json') {
    /**
     * @type {Readable}
     */
    const stream = cursor.stream();

    const useJson = contentType !== 'application/fhir+ndjson';

    let openJson = useJson ? '[' : '';
    let closeJson = useJson ? ']' : '';

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
                    yield resources[0];
                } else {
                    yield null;
                }
            }
        },
        // https://www.npmjs.com/package/JSONStream
        JSONStream.stringify(openJson, useJson ? ',' : '\n', closeJson),
        res.type(contentType)
    );
}


module.exports = {
    streamResourcesFromCursor: streamResourcesFromCursor
};
