const {pipeline} = require('stream/promises');
const {FhirBundleWriter} = require('../streaming/fhirBundleWriter');
const {ResourceIdTracker} = require('../streaming/resourceIdTracker');
const {logError} = require('../common/logging');
const {createReadableMongoStream} = require('../streaming/mongoStreamReader');
const {ResourcePreparerTransform} = require('../streaming/resourcePreparer');
const {HttpResponseWriter} = require('../streaming/responseWriter');
const {ObjectChunker} = require('../streaming/objectChunker');
const assert = require('node:assert/strict');

/**
 * @typedef StreamBundleParameters
 * @type {object}
 * @property {DatabasePartitionedCursor} cursor
 * @property {string|null} requestId
 * @property {string | null} url
 * @property {function (string | null, number): Resource} fnBundle
 * @property {import('http').ServerResponse} res
 * @property {string | null} user
 * @property {string | null} scope
 * @property {Object|null} args
 * @property {function (?Object): Resource} ResourceCreator
 * @property {string} resourceType
 * @property {boolean} useAccessIndex
 * @property {number} batchObjectCount
 */

/**
 * Reads resources from Mongo cursor and writes to response
 * @param {StreamBundleParameters} options
 * @returns {Promise<string[]>}
 */
async function streamBundleFromCursorAsync(options) {
    const {
        requestId,
        cursor, url, fnBundle,
        res, user, scope,
        args, ResourceCreator, resourceType,
        useAccessIndex,
        batchObjectCount
    } = options;
    assert(requestId);
    /**
     * @type {AbortController}
     */
    const ac = new AbortController();

    /**
     * @type {FhirBundleWriter}
     */
    const fhirBundleWriter = new FhirBundleWriter(fnBundle, url, ac.signal);

    /**
     * @type {{id: string[]}}
     */
    const tracker = {
        id: []
    };

    // if response is closed then abort the pipeline
    res.on('close', () => {
        ac.abort();
    });

    /**
     * @type {HttpResponseWriter}
     */
    const responseWriter = new HttpResponseWriter(requestId, res, 'application/fhir+json', ac.signal);

    const resourcePreparerTransform = new ResourcePreparerTransform(user, scope, args, ResourceCreator, resourceType, useAccessIndex, ac.signal);
    const resourceIdTracker = new ResourceIdTracker(tracker, ac.signal);

    const objectChunker = new ObjectChunker(batchObjectCount, ac.signal);

    try {
        const readableMongoStream = createReadableMongoStream(cursor, ac.signal);
        readableMongoStream.on('close', () => {
            // console.log('Mongo read stream was closed');
            // ac.abort();
        });
        // https://nodejs.org/docs/latest-v16.x/api/stream.html#streams-compatibility-with-async-generators-and-async-iterators
        await pipeline(
            readableMongoStream,
            objectChunker,
            resourcePreparerTransform,
            resourceIdTracker,
            fhirBundleWriter,
            responseWriter
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
    streamBundleFromCursorAsync
};
