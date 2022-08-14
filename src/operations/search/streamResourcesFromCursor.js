const {pipeline} = require('stream/promises');
const {FhirResourceWriter} = require('../streaming/fhirResourceWriter');
const {FhirResourceNdJsonWriter} = require('../streaming/fhirResourceNdJsonWriter');
const {ResourceIdTracker} = require('../streaming/resourceIdTracker');
const {fhirContentTypes} = require('../../utils/contentTypes');
const {logError} = require('../common/logging');
const {ResourcePreparerTransform} = require('../streaming/resourcePreparer');
const {createReadableMongoStream} = require('../streaming/mongoStreamReader');
const {HttpResponseWriter} = require('../streaming/responseWriter');
const {ObjectChunker} = require('../streaming/objectChunker');
const assert = require('node:assert/strict');

/**
 * @typedef StreamResourcesParameters
 * @type {object}
 * @property {DatabasePartitionedCursor} cursor
 * @property {string|null} requestId
 * @property {import('http').ServerResponse} res
 * @property {string | null} user
 * @property {string | null} scope
 * @property {Object|null} args
 * @property {function (?Object): Resource} ResourceCreator
 * @property {string} resourceType
 * @property {boolean} useAccessIndex
 * @property {string} contentType
 * @property {number} batchObjectCount
 */

/**
 * Reads resources from Mongo cursor and writes to response
 * @param {StreamResourcesParameters} options
 * @returns {Promise<string[]>} ids of resources streamed
 */
async function streamResourcesFromCursorAsync(options) {

    const {
        requestId,
        cursor,
        res,
        user,
        scope,
        args,
        ResourceCreator,
        resourceType,
        useAccessIndex,
        contentType = 'application/fhir+json',
        // eslint-disable-next-line no-unused-vars
        batchObjectCount = 1
    } = options;
    assert(requestId);
    console.log(`streamResourcesFromCursorAsync: ${this.requestId}`);
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
    const responseWriter = new HttpResponseWriter(requestId, res, contentType, ac.signal);
    /**
     * @type {ResourcePreparerTransform}
     */
    const resourcePreparerTransform = new ResourcePreparerTransform(user, scope, args, ResourceCreator, resourceType, useAccessIndex, ac.signal);
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
            // console.log('Mongo read stream was closed');
            // ac.abort();
        });

        const objectChunker = new ObjectChunker(batchObjectCount, ac.signal);

        // now setup and run the pipeline
        await pipeline(
            readableMongoStream,
            objectChunker,
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
    if (!res.writableEnded) {
        res.end();
    }
    return tracker.id;
}


module.exports = {
    streamResourcesFromCursorAsync
};
