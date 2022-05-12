const {pipeline} = require('stream/promises');
const {FhirBundleWriter} = require('../streaming/fhirBundleWriter');
const {ResourceIdTracker} = require('../streaming/resourceIdTracker');
const {logError} = require('../common/logging');
const {createReadableMongoStream} = require('../streaming/mongoStreamReader');
const {ResourcePreparerTransform} = require('../streaming/resourcePreparer');

/**
 * Reads resources from Mongo cursor and writes to response
 * @param {import('mongodb').FindCursor<import('mongodb').WithId<Document>>} cursor
 * @param {string | null} url
 * @param {function (string | null, number): Resource} fnBundle
 * @param {import('http').ServerResponse} res
 * @param {string | null} user
 * @param {string | null} scope
 * @param {Object?} args
 * @param {function (Object): Resource} Resource
 * @param {string} resourceName
 * @param {number} batchObjectCount
 * @returns {Promise<number>}
 */
async function streamBundleFromCursorAsync(
    cursor, url, fnBundle, res, user, scope,
    args, Resource, resourceName,
    // eslint-disable-next-line no-unused-vars
    batchObjectCount
) {
    const fhirBundleWriter = new FhirBundleWriter(fnBundle, url);

    const tracker = {
        id: []
    };

    const ac = new AbortController();

    try {
        const readableMongoStream = createReadableMongoStream(cursor);
        readableMongoStream.on('close', () => {
            ac.abort();
        });
        // https://nodejs.org/docs/latest-v16.x/api/stream.html#streams-compatibility-with-async-generators-and-async-iterators
        await pipeline(
            readableMongoStream,
            // new ObjectChunker(batchObjectCount),
            new ResourcePreparerTransform(user, scope, args, Resource, resourceName),
            new ResourceIdTracker(tracker),
            fhirBundleWriter,
            res.type('application/fhir+json')
        );
    } catch (e) {
        logError(user, e);
        ac.abort();
        throw e;
    }
    return tracker.id;
}


module.exports = {
    streamBundleFromCursorAsync: streamBundleFromCursorAsync
};
