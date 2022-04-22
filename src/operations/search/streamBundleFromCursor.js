const {pipeline} = require('stream/promises');
const {prepareResource} = require('../common/resourcePreparer');
const {FhirBundleWriter} = require('../streaming/fhirBundleWriter');
const {ResourceIdTracker} = require('../streaming/resourceIdTracker');

/**
 * Reads resources from Mongo cursor
 * @param {import('mongodb').FindCursor<import('mongodb').WithId<Document>>} cursor
 * @param {string | null} url
 * @param {Resource} bundle
 * @param {import('http').ServerResponse} res
 * @param {string | null} user
 * @param {string | null} scope
 * @param {Object?} args
 * @param {function (Object): Resource} Resource
 * @param {string} resourceName
 * @returns {Promise<number>}
 */
async function streamBundleFromCursor(cursor, url, bundle, res, user, scope,
                                      args, Resource, resourceName) {
    /**
     * @type {Readable}
     */
    const stream = cursor.stream();

    const fhirBundleWriter = new FhirBundleWriter(bundle, url);

    const tracker = {
        id: []
    };

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
        new ResourceIdTracker(tracker),
        fhirBundleWriter,
        res.type('application/fhir+json')
    );
    return tracker.id;
}


module.exports = {
    streamBundleFromCursor: streamBundleFromCursor
};
