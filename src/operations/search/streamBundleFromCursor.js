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
 * Reads resources from Mongo cursor and writes to response
 * @param {DatabasePartitionedCursor} cursor
 * @param {string} requestId
 * @param {import('mongodb').Cursor<import('mongodb').WithId<import('mongodb').Document>>} cursor
 * @param {string | null} url
 * @param {function (string | null, number): Resource} fnBundle
 * @param {import('http').ServerResponse} res
 * @param {string | null} user
 * @param {string | null} scope
 * @param {Object?} args
 * @param {function (Object): Resource} Resource
 * @param {string} resourceName
 * @param {boolean} useAccessIndex
 * @param {number} batchObjectCount
 * @returns {Promise<string[]>}
 */
async function streamBundleFromCursorAsync(
    requestId,
    cursor, url, fnBundle,
    res, user, scope,
    args, Resource, resourceName,
    useAccessIndex,
    // eslint-disable-next-line no-unused-vars
    batchObjectCount
) {
    assert(requestId);
    console.log(`streamBundleFromCursorAsync: ${this.requestId}`);

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

    const resourcePreparerTransform = new ResourcePreparerTransform(user, scope, args, Resource, resourceName, useAccessIndex, ac.signal);
    const resourceIdTracker = new ResourceIdTracker(tracker, ac.signal);

    const objectChunker = new ObjectChunker(batchObjectCount, ac.signal);

    try {
        const readableMongoStream = createReadableMongoStream(cursor, ac.signal);
        readableMongoStream.on('close', () => {
            console.log('Mongo read stream was closed');
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
