const { Readable } = require('stream');
const { logInfo, logError } = require('../common/logging');
const { assertTypeEquals } = require('../../utils/assertType');
const { ConfigManager } = require('../../utils/configManager');
const { RethrownError } = require('../../utils/rethrownError');
const { convertErrorToOperationOutcome } = require('../../utils/convertErrorToOperationOutcome');
const { captureException } = require('../common/sentry');
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
            highWaterMark,
            configManager,
            response
        }
    ) {
        super({ objectMode: true, highWaterMark: highWaterMark });

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
    }

    // eslint-disable-next-line no-unused-vars
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
     * @returns {Promise<void>}
     */
    async readAsync (size) {
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
                // send the error to sentry
                captureException(error);
                /**
                 * @type {OperationOutcome}
                 */
                const operationOutcome = convertErrorToOperationOutcome({
                    error: {
                        ...error,
                        message: 'Error occurred while streaming response'
                    }
                });
                // this is an unexpected error so set statuscode 500
                this.response.statusCode = 500;
                this.push(operationOutcome);
                return;
            }
        }
    }
}

module.exports = {
    MongoReadableStream
};
