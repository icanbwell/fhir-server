const {pipeline} = require('stream/promises');
const {FhirResourceWriter} = require('../streaming/fhirResourceWriter');
const {FhirResourceNdJsonWriter} = require('../streaming/fhirResourceNdJsonWriter');
const {ResourceIdTracker} = require('../streaming/resourceIdTracker');
const {fhirContentTypes} = require('../../utils/contentTypes');
const {logError} = require('../common/logging');
const {ResourcePreparerTransform} = require('../streaming/resourcePreparer');
const {createReadableMongoStream} = require('../streaming/mongoStreamReader');

/**
 * Reads resources from Mongo cursor and writes to response
 * @param {import('mongodb').Cursor<import('mongodb').WithId<import('mongodb').Document>>} cursor
 * @param {import('http').ServerResponse} res
 * @param {string | null} user
 * @param {string | null} scope
 * @param {Object?} args
 * @param {function (Object): Resource} Resource
 * @param {string} resourceName
 * @param {boolean} useAccessIndex
 * @param {string} contentType
 * @param {number} batchObjectCount
 * @returns {Promise<string[]>} ids of resources streamed
 */
async function streamResourcesFromCursorAsync(
    cursor, res, user, scope,
    args,
    Resource,
    resourceName,
    useAccessIndex,
    contentType = 'application/fhir+json',
    // eslint-disable-next-line no-unused-vars
    batchObjectCount = 1) {

    /**
     * @type {boolean}
     */
    const useJson = contentType !== fhirContentTypes.ndJson;

    /**
     * @type {FhirResourceWriter|FhirResourceNdJsonWriter}
     */
    const fhirWriter = useJson ? new FhirResourceWriter() : new FhirResourceNdJsonWriter();

    /**
     * @type {{id: *[]}}
     */
    const tracker = {
        id: []
    };

    /**
     * @type {AbortController}
     */
    const ac = new AbortController();

    try {
        const readableMongoStream = createReadableMongoStream(cursor);
        readableMongoStream.on('close', () => {
            ac.abort();
        });

        await pipeline(
            readableMongoStream,
            // new ObjectChunker(batchObjectCount),
            new ResourcePreparerTransform(user, scope, args, Resource, resourceName, useAccessIndex),
            new ResourceIdTracker(tracker),
            fhirWriter,
            res.type(contentType)
        );
    } catch (e) {
        logError(user, e);
        ac.abort();
        throw e;
    }
    return tracker.id;
}


module.exports = {
    streamResourcesFromCursorAsync: streamResourcesFromCursorAsync
};
