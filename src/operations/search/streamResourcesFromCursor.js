const {pipeline} = require('stream/promises');
const {FhirResourceWriter} = require('../streaming/fhirResourceWriter');
const {FhirResourceNdJsonWriter} = require('../streaming/fhirResourceNdJsonWriter');
const {ResourceIdTracker} = require('../streaming/resourceIdTracker');
const {fhirContentTypes} = require('../../utils/contentTypes');
const {logError} = require('../common/logging');
const {ResourcePreparerTransform} = require('../streaming/resourcePreparer');
const {createReadableMongoStream} = require('../streaming/mongoStreamReader');
const {HttpResponseWriter} = require('../streaming/responseWriter');

// const {Transform} = require('stream');

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
     * @type {{id: *[]}}
     */
    const tracker = {
        id: []
    };

    /**
     * @type {AbortController}
     */
    const ac = new AbortController();

    // if response is closed then abort the pipeline
    res.on('close', () => {
        console.log('HTTP Response stream was closed');
        ac.abort();
    });

    res.on('error', (err) => {
        console.error(err);
    });
    /**
     * @type {FhirResourceWriter|FhirResourceNdJsonWriter}
     */
    const fhirWriter = useJson ? new FhirResourceWriter(ac.signal) : new FhirResourceNdJsonWriter(ac.signal);

    /**
     * @type {HttpResponseWriter}
     */
    const responseWriter = new HttpResponseWriter(res, contentType, ac.signal);
    /**
     * @type {ResourcePreparerTransform}
     */
    const resourcePreparerTransform = new ResourcePreparerTransform(user, scope, args, Resource, resourceName, useAccessIndex, ac.signal);
    /**
     * @type {ResourceIdTracker}
     */
    const resourceIdTracker = new ResourceIdTracker(tracker, ac.signal);

    // function sleep(ms) {
    //     return new Promise(resolve => setTimeout(resolve, ms));
    // }

    try {
        const readableMongoStream = createReadableMongoStream(cursor, ac.signal);
        readableMongoStream.on('close', () => {
            console.log('Mongo read stream was closed');
            ac.abort();
        });

        // now setup and run the pipeline
        await pipeline(
            readableMongoStream,
            // new ObjectChunker(batchObjectCount),
            // new Transform({
            //     objectMode: true,
            //     transform(chunk, encoding, callback) {
            //         sleep(60 * 1000).then(callback);
            //     }
            // }),
            resourcePreparerTransform,
            resourceIdTracker,
            fhirWriter,
            responseWriter,
            // res.type(contentType)
        );
    } catch (e) {
        logError(user, e);
        ac.abort();
        throw e;
    }
    // res.end();
    return tracker.id;
}


module.exports = {
    streamResourcesFromCursorAsync: streamResourcesFromCursorAsync
};
