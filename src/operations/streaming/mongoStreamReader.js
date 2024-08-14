const { Readable } = require('stream');
const { logInfo, logError } = require('../common/logging');
const { assertTypeEquals } = require('../../utils/assertType');
const { ConfigManager } = require('../../utils/configManager');
const { RethrownError } = require('../../utils/rethrownError');
const { convertErrorToOperationOutcome } = require('../../utils/convertErrorToOperationOutcome');
const { captureException } = require('../common/sentry');
const { SearchManager } = require('../search/searchManager');
const { RETRIEVE } = require('../../constants').GRIDFS;

// https://thenewstack.io/node-js-readable-streams-explained/
// https://github.com/logdna/tail-file-node/blob/ee0389ba34cb2037de776541f800842bb98df6b3/lib/tail-file.js#L22
// https://2ality.com/2019/11/nodejs-streams-async-iteration.html

class MongoReadableStream extends Readable {
    /**
     * constructor
     * @param {DatabasePartitionedCursor} cursor
     * @param {AbortSignal} signal
     * @param {DatabaseAttachmentManager} databaseAttachmentManager
     * @param {number} highWaterMark
     * @param {ConfigManager} configManager
     * @param {import('http').ServerResponse} response
     */
    constructor (
        {
            cursor,
            signal,
            databaseAttachmentManager,
            searchManager,
            highWaterMark,
            configManager,
            response,
            params
        }
    ) {
        super({ objectMode: true, highWaterMark });

        /**
         * @type {DatabasePartitionedCursor}
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
                return;
            }
            this.isFetchingData = false;
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
                if (await this.cursor.hasNext()) {
                    if (this.signal.aborted) {
                        if (this.configManager.logStreamSteps) {
                            logInfo('mongoStreamReader: aborted', { size });
                        }
                        return;
                    }
                    count++;
                    /**
                     * element
                     * @type {Resource}
                     */
                    let resource = await this.cursor.next();
                    this.lastUUID = resource._uuid;
                    if (this.configManager.logStreamSteps) {
                        logInfo(`mongoStreamReader: read ${resource.id}`, { count, size });
                    }
                    if (this.databaseAttachmentManager) {
                        resource = await this.databaseAttachmentManager.transformAttachments(resource, RETRIEVE);
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
                const error = new RethrownError({ message: e.message, error: e, args: {}, source: 'readAsync' });
                logError(`MongoReadableStream readAsync: error: ${e.message}`, {
                    error: e,
                    source: 'MongoReadableStream.readAsync',
                    args: {
                        stack: e?.stack,
                        message: e.message
                    }
                });

                // Handles operation timeout error in mongodb
                if (e.statusCode === 50 && !hasRetried && this.lastUUID) {
                    logInfo(
                        'MongoReadableStream readAsync: Retrying with new cursor due to mongo query timeout',
                        { e }
                    );

                    // Increasing maxMongoTimeMS to ensure streaming process to continue for an extended period.
                    this.params.maxMongoTimeMS = this.configManager.mongoStreamingTimeout;

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
                    await this.readCursorAsync({size, hasRetried: true}); // Pass true to indicate that retry has happened
                    return;
                }

                // send the error to sentry
                captureException(error);
                /**
                 * @type {OperationOutcome}
                 */
                const operationOutcome = convertErrorToOperationOutcome({
                    error: {
                        ...error,
                        message:
                            e.statusCode === 50
                                ? 'Timeout while processing'
                                : 'Error occurred while streaming response'
                    }
                });
                // this is an unexpected error so set statusCode 500
                this.response.statusCode = 500;
                this.push(operationOutcome);
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
