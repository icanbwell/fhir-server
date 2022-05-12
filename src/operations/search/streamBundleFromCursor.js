const {pipeline} = require('stream/promises');
const {prepareResourceAsync} = require('../common/resourcePreparer');
const {FhirBundleWriter} = require('../streaming/fhirBundleWriter');
const {ResourceIdTracker} = require('../streaming/resourceIdTracker');
const {logError} = require('../common/logging');
const {ObjectChunker} = require('../streaming/objectChunker');

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
    args, Resource, resourceName, batchObjectCount) {
    const fhirBundleWriter = new FhirBundleWriter(fnBundle, url);

    const tracker = {
        id: []
    };

    try {
        // https://nodejs.org/docs/latest-v16.x/api/stream.html#streams-compatibility-with-async-generators-and-async-iterators
        await pipeline(
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
            // new ObjectChunker(batchObjectCount),
            // new ResourcePreparerTransform(user, scope, args, Resource, resourceName),
            async function* (source) {
                for await (const chunk of source) {
                    /**
                     * @type {Resource[]}
                     */
                    const resources = await prepareResourceAsync(user, scope, args, Resource, chunk, resourceName);
                    if (resources.length > 0) {
                        for (const resource of resources) {
                            yield resource;
                        }
                    } else {
                        yield null;
                    }
                }
            },
            new ResourceIdTracker(tracker),
            fhirBundleWriter,
            res.type('application/fhir+json')
        );
    } catch (e) {
        logError(user, e);
        throw e;
    }
    return tracker.id;
}


module.exports = {
    streamBundleFromCursorAsync: streamBundleFromCursorAsync
};
