const { Readable } = require('stream');
const { logInfo, logError } = require('../common/logging');
const { assertTypeEquals } = require('../../utils/assertType');
const { ConfigManager } = require('../../utils/configManager');
const { RethrownError } = require('../../utils/rethrownError');
const { convertErrorToOperationOutcome } = require('../../utils/convertErrorToOperationOutcome');
const { captureException } = require('../common/sentry');
const { Base64DataManager } = require('../../dataLayer/base64DataManager');
const { RETRIEVE } = require('../../constants').GRIDFS;
const { BLOB_OP } = require('../../constants');

/**
 * Upper bound on waiting for cursor.close(). Closing an abandoned cursor is best-effort; if the
 * connection it is pinned to is unresponsive we would rather give up and end the stream than
 * hang the request on cleanup.
 * @type {number}
 */
const CURSOR_CLOSE_TIMEOUT_MS = 5000;

// https://thenewstack.io/node-js-readable-streams-explained/
// https://github.com/logdna/tail-file-node/blob/ee0389ba34cb2037de776541f800842bb98df6b3/lib/tail-file.js#L22
// https://2ality.com/2019/11/nodejs-streams-async-iteration.html

class MongoReadableStream extends Readable {
    /**
     * constructor
     * @param {DatabaseCursor} cursor
     * @param {AbortSignal} signal
     * @param {DatabaseAttachmentManager} databaseAttachmentManager
     * @param {Base64DataManager} [base64DataManager]
     * @param {number} highWaterMark
     * @param {ConfigManager} configManager
     * @param {import('http').ServerResponse} response
     */
    constructor (
        {
            cursor,
            signal,
            databaseAttachmentManager,
            base64DataManager,
            searchManager,
            highWaterMark,
            configManager,
            response,
            params
        }
    ) {
        super({ objectMode: true, highWaterMark });

        /**
         * @type {DatabaseCursor}
         */
        this.cursor = cursor;

        /**
         * @type {AbortSignal}
         */
        this.signal = signal;

        /**
         * @type {DatabaseAttachmentManager}
         */
        this.databaseAttachmentManager = databaseAttachmentManager;

        /**
         * @type {Base64DataManager}
         */
        this.base64DataManager = base64DataManager;
        if (base64DataManager) {
            assertTypeEquals(base64DataManager, Base64DataManager);
        }

        /**
         * @type {ConfigManager}
         */
        this.configManager = configManager;
        assertTypeEquals(configManager, ConfigManager);

        /**
         * @type {boolean}
         */
        this.isFetchingData = false; // Track if data is currently being fetched
        /**
         * @type {import('http').ServerResponse}
         */
        this.response = response;

        /**
         * @type {SearchManager}
         */
        this.searchManager = searchManager;
        /**
         * @type {string}
         */
        this.lastUUID = null;

        this.params = params;

        /**
         * true once close() has been requested on the current cursor
         * @type {boolean}
         */
        this.cursorClosed = false;

        /**
         * Set when the stream is destroyed while a driver call is in flight; the cursor is
         * then closed after that call returns (see _destroy) instead of concurrently with it.
         * @type {boolean}
         */
        this.closeCursorAfterRead = false;
    }

    /**
     * Closes the current cursor so the server-side cursor and, in load-balanced mode, the
     * connection pinned to it are released. Without this an abandoned streaming search keeps
     * its connection checked out for the life of the cursor, and five of them exhaust a worker's
     * pool (INC-357). Safe to call more than once and on cursors that have no close().
     * @param {string} reason
     * @returns {Promise<void>}
     */
    async closeCursorAsync (reason) {
        if (this.cursorClosed || !this.cursor || typeof this.cursor.close !== 'function') {
            return;
        }
        this.cursorClosed = true;
        let timer;
        const timeout = new Promise((resolve) => {
            timer = setTimeout(() => resolve('timeout'), CURSOR_CLOSE_TIMEOUT_MS);
        });
        try {
            const outcome = await Promise.race([
                Promise.resolve(this.cursor.close()).then(() => 'closed'),
                timeout
            ]);
            if (outcome === 'timeout') {
                logError(`mongoStreamReader: cursor close timed out after ${CURSOR_CLOSE_TIMEOUT_MS}ms on ${reason}`, { reason });
            } else if (this.configManager.logStreamSteps) {
                logInfo('mongoStreamReader: cursor closed', { reason });
            }
        } catch (e) {
            // best-effort: the cursor is already abandoned, there is nothing to recover
            logError(`mongoStreamReader: error closing cursor on ${reason}: ${e.message}`, { error: e, reason });
        } finally {
            clearTimeout(timer);
        }
    }

    /**
     * Ends the stream after the request was aborted (client disconnected): closes the cursor
     * and signals EOF so the pipeline completes instead of hanging.
     * @param {number} size
     * @returns {Promise<void>}
     */
    async endAbortedStreamAsync ({ size }) {
        if (this.configManager.logStreamSteps) {
            logInfo('mongoStreamReader: aborted', { size });
        }
        await this.closeCursorAsync('abort');
        this.push(null);
    }

    /**
     * Called when the stream is destroyed (pipeline error, explicit destroy, or autoDestroy after
     * EOF): release the cursor. If a driver call (hasNext/next/rebuild) is still in flight the
     * close is deferred to _read's finally block so killCursors is never written on the pinned
     * connection while a getMore reply is pending; the destroy callback is not held up by that,
     * so the pipeline settles and res.end() runs without waiting on Mongo.
     * @param {Error|null} error
     * @param {function(Error|null): void} callback
     * @private
     */
    _destroy (error, callback) {
        if (this.isFetchingData) {
            this.closeCursorAfterRead = true;
            callback(error);
            return;
        }
        this.closeCursorAsync('destroy').then(
            () => callback(error),
            () => callback(error)
        );
    }

    async _read (size) {
        // Ensure we are not already fetching data
        if (!this.isFetchingData) {
            this.isFetchingData = true;
            try {
                await this.readAsync(size);
            } catch (error) {
                // Handle any errors that may occur during data retrieval
                this.emit('error', error);
                this.push(null); // Signal the end of the stream
            } finally {
                this.isFetchingData = false;
                if (this.closeCursorAfterRead) {
                    this.closeCursorAfterRead = false;
                    await this.closeCursorAsync('destroy');
                }
            }
        }
    }

    /**
     * @param size
     * @param hasRetried
     * @returns {Promise<void>}
     */
    async readCursorAsync({size, hasRetried = false}) {
        let count = 0;
        while (count <= size) {
            try {
                if (this.destroyed) {
                    // the pipeline already tore the stream down; _read's finally closes the cursor
                    return;
                }
                if (this.signal.aborted) {
                    await this.endAbortedStreamAsync({ size });
                    return;
                }
                if (await this.cursor.hasNext()) {
                    if (this.destroyed) {
                        return;
                    }
                    if (this.signal.aborted) {
                        await this.endAbortedStreamAsync({ size });
                        return;
                    }
                    count++;
                    /**
                     * element
                     * @type {Resource}
                     */
                    let resource = await this.cursor.next();
                    if (!resource) {
                        this.push(null);
                        return;
                    }
                    this.lastUUID = resource._uuid;
                    if (this.configManager.logStreamSteps) {
                        logInfo(`mongoStreamReader: read ${resource.id}`, { count, size });
                    }
                    if (this.databaseAttachmentManager) {
                        resource = await this.databaseAttachmentManager.transformAttachments(resource, RETRIEVE);
                    }
                    if (this.base64DataManager) {
                        resource = await this.base64DataManager.transformAsync(resource, BLOB_OP.RETRIEVE);
                    }
                    this.push(resource);
                } else {
                    if (this.configManager.logStreamSteps) {
                        logInfo('mongoStreamReader: finish', { count, size });
                    }
                    this.push(null);
                    return;
                }
            } catch (e) {
                // Handles operation timeout error in mongodb. Retry only when this.params is
                // either a rebuildCursorAsync-supplying caller or a full FHIR-search-shaped
                // object (resourceType, parsedArgs, columns, etc.) -- getCursorForQueryAsync's
                // contract below. A caller with a minimal ad-hoc params object (e.g. GroupMember's
                // live-roster query, which only ever sets {query}) doesn't fit either shape, so
                // retrying would throw a confusing TypeError instead of the timeout itself; fall
                // through to the generic non-retryable error handling below instead.
                const canRetry = Boolean(this.params.rebuildCursorAsync || this.params.resourceType);
                if (e.code === 50 && !hasRetried && this.lastUUID && canRetry) {
                    if (this.destroyed || this.signal.aborted) {
                        // nobody is reading any more: do not build a cursor that would never be closed
                        await this.closeCursorAsync('retry');
                        if (!this.destroyed) {
                            this.push(null);
                        }
                        return;
                    }
                    logInfo(
                        'MongoReadableStream readAsync: Retrying with new cursor due to mongo query timeout',
                        { e }
                    );

                    // Increasing maxMongoTimeMS to ensure streaming process to continue for an extended period.
                    this.params.maxMongoTimeMS = this.configManager.mongoStreamingTimeout;

                    // release the timed-out cursor before replacing it
                    await this.closeCursorAsync('retry');

                    if (this.params.rebuildCursorAsync) {
                        // Caller-supplied resumption -- for a cursor this class didn't build
                        // itself (e.g. an aggregation pipeline, which doesn't fit
                        // searchManager.getCursorForQueryAsync's plain-find contract below).
                        // The callback is responsible for scoping past this.lastUUID itself.
                        this.cursor = await this.params.rebuildCursorAsync({
                            lastUUID: this.lastUUID,
                            maxMongoTimeMS: this.params.maxMongoTimeMS
                        });
                    } else {
                        // Update existing query to not fetch resources with already processed uuids
                        const uuidFromQuery = { _uuid: { $gt: this.lastUUID } };
                        if (this.params.query.$and) {
                            this.params.query.$and = [
                                uuidFromQuery,
                                ...this.params.query.$and.map((f) => f)
                            ];
                        } else {
                            this.params.query = { $and: [this.params.query, uuidFromQuery] };
                        }

                        /**
                         * @type {GetCursorResult}
                         */
                        const __ret = await this.searchManager.getCursorForQueryAsync({
                            ...this.params
                        });
                        this.cursor = __ret.cursor;
                    }
                    this.cursorClosed = false;
                    if (this.destroyed) {
                        // destroyed while the replacement cursor was being built: release it now,
                        // _destroy already ran and will not see it
                        await this.closeCursorAsync('destroy');
                        return;
                    }
                    await this.readCursorAsync({size, hasRetried: true}); // Pass true to indicate that retry has happened
                    return;
                }

                await this.closeCursorAsync('error');
                const error = new RethrownError({ message: e.message, error: e, args: {}, source: 'readAsync' });
                logError(`MongoReadableStream readAsync: error: ${e.message}`, {
                    error: e,
                    source: 'MongoReadableStream.readAsync',
                    args: {
                        stack: e?.stack,
                        message: e.message
                    }
                });

                // send the error to sentry
                captureException(error);
                /**
                 * @type {OperationOutcome}
                 */
                const operationOutcome = convertErrorToOperationOutcome({
                    error: {
                        ...error,
                        message:
                            e.code === 50
                                ? 'Timeout while processing'
                                : 'Error occurred while streaming response'
                    }
                });
                // this is an unexpected error so set statusCode 500
                this.response.statusCode = 500;
                this.push(operationOutcome);
                this.push(null);
                return;
            }
        }
    }

    /**
     * @param size
     * @returns {Promise<void>}
     */
    async readAsync(size) {
        await this.readCursorAsync({size});
    }

}

module.exports = {
    MongoReadableStream
};
