const {pipeline} = require('stream/promises');
const {prepareResource} = require('../common/resourcePreparer');
const {FhirBundleWriter} = require('../streaming/fhirBundleWriter');
const {ResourceIdTracker} = require('../streaming/resourceIdTracker');
const {logError} = require('../common/logging');

/**
 * Reads resources from Mongo cursor
 * @param {import('mongodb').FindCursor<import('mongodb').WithId<Document>>} cursor
 * @param {string | null} url
 * @param {function (string | null, number): Resource} fnBundle
 * @param {import('http').ServerResponse} res
 * @param {string | null} user
 * @param {string | null} scope
 * @param {Object?} args
 * @param {function (Object): Resource} Resource
 * @param {string} resourceName
 * @returns {Promise<number>}
 */
async function streamBundleFromCursor(cursor, url, fnBundle, res, user, scope,
                                      args, Resource, resourceName) {
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
            // new ResourcePreparerTransform(user, scope, args, Resource, resourceName),
            async function* (source) {
                for await (const chunk of source) {
                    /**
                     * @type {Resource[]}
                     */
                    const resources = await prepareResource(user, scope, args, Resource, chunk, resourceName);
                    if (resources.length > 0) {
                        for (const resource in resources) {
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
    streamBundleFromCursor: streamBundleFromCursor
};
