const { Transform } = require('stream');
const { logInfo, logError } = require('../common/logging');
const { assertTypeEquals } = require('../../utils/assertType');
const { ConfigManager } = require('../../utils/configManager');
const { RethrownError } = require('../../utils/rethrownError');
const { convertErrorToOperationOutcome } = require('../../utils/convertErrorToOperationOutcome');
const { captureException } = require('../common/sentry');

class ResourcePreparerTransform extends Transform {
    /**
     * Batches up objects to chunkSize before writing them to output
     * @param {ParsedArgs} parsedArgs
     * @param {string} resourceType
     * @param {AbortSignal} signal
     * @param {ResourcePreparer} resourcePreparer
     * @param {number} highWaterMark
     * @param {ConfigManager} configManager
     * @param {import('http').ServerResponse} response
     * @param {boolean} rawResources
     */
    constructor (
        {
            parsedArgs,
            resourceType,
            signal,
            resourcePreparer,
            highWaterMark,
            configManager,
            response,
            rawResources = false
        }
    ) {
        super({ objectMode: true, highWaterMark });
        /**
         * @type {ParsedArgs}
         */
        this.parsedArgs = parsedArgs;
        /**
         * @type {string}
         */
        this.resourceName = resourceType;
        /**
         * @type {AbortSignal}
         */
        this._signal = signal;
        /**
         * @type {ResourcePreparer}
         */
        this.resourcePreparer = resourcePreparer;
        /**
         * @type {import('http').ServerResponse}
         */
        this.response = response;
        /**
         * @type {Boolean}
         */
        this.rawResources = rawResources;


        /**
         * @type {ConfigManager}
         */
        this.configManager = configManager;
        assertTypeEquals(configManager, ConfigManager);
    }

    /**
     * transforms a chunk
     * @param {Object} chunk
     * @param {import('stream').BufferEncoding} encoding
     * @param {import('stream').TransformCallBack} callback
     * @private
     */
    _transform (chunk, encoding, callback) {
        if (this._signal.aborted) {
            // https://nodejs.org/en/learn/asynchronous-work/dont-block-the-event-loop#partitioning
            // calling in setImmediate to process it in next iteration of event loop
            // and unblock other requests
            setImmediate(callback);
            return;
        }
        try {
            const chunks = Array.isArray(chunk) ? chunk : [chunk];

            const processChunksAsync = async () => {
                // process serially to maintain the order
                for (const chunk1 of chunks) {
                    try {
                        await this.processChunkAsync(chunk1);
                    } catch (error) {
                        logError(
                            `ResourcePreparer _transform: error: ${error.message || error}. id: ${
                                chunk1.id
                            }`,
                            {
                                error,
                                source: 'ResourcePreparer._transform',
                                args: {
                                    id: chunk1.id,
                                    stack: error?.stack,
                                    message: error.message
                                }
                            }
                        );
                        const rethrownError = new RethrownError({
                            message: `ResourcePreparer _transform: error: ${error.message}. id: ${chunk1.id}`,
                            args: {
                                id: chunk1.id,
                                chunk: chunk1,
                                reason: error,
                                message: error?.message,
                                stack: error?.stack
                            },
                            error
                        });
                        captureException(rethrownError);
                        /**
                         * @type {OperationOutcome}
                         */
                        const operationOutcome = convertErrorToOperationOutcome({
                            error: {
                                ...rethrownError,
                                message: `Error occurred while streaming response for chunk: ${chunk1.id}`
                            }
                        });
                        this.push(operationOutcome);
                    }
                }
            };
            processChunksAsync().finally(() => {
                // https://nodejs.org/en/learn/asynchronous-work/dont-block-the-event-loop#partitioning
                // calling in setImmediate to process it in next iteration of event loop
                // and unblock other requests
                setImmediate(callback);
            });
        } catch (e) {
            logError(`ResourcePreparer _transform: error: ${e.message || e}. id: ${chunk.id}`, {
                error: e,
                source: 'ResourcePreparer._transform',
                args: {
                    id: chunk.id,
                    stack: e?.stack,
                    message: e.message
                }
            });
            const error = new RethrownError({
                message: `ResourcePreparer _transform: error: ${e.message}. id: ${chunk.id}`,
                error: e,
                args: {
                    id: chunk.id,
                    chunk
                }
            });

            captureException(error);
            /**
             * @type {OperationOutcome}
             */
            const operationOutcome = convertErrorToOperationOutcome({
                error: {
                    ...error, message: `Error occurred while streaming response for chunk: ${chunk.id}`
                }
            });
            // this is an unexpected error so set statuscode 500
            this.response.statusCode = 500;
            this.push(operationOutcome);
            // https://nodejs.org/en/learn/asynchronous-work/dont-block-the-event-loop#partitioning
            // calling in setImmediate to process it in next iteration of event loop
            // and unblock other requests
            setImmediate(callback);
        }
    }

    /**
     * processes a chunk
     * @param chunk1
     * @returns {Promise<Resource[]>}
     */
    async processChunkAsync (chunk1) {
        return this.resourcePreparer.prepareResourceAsync(
            {
                parsedArgs: this.parsedArgs,
                element: chunk1,
                resourceType: this.resourceName,
                rawResources: this.rawResources
            })
            .then(
                /** @type {Resource[]} */resources => {
                    if (resources.length > 0) {
                        for (const /** @type {Resource} */ resource of resources) {
                            if (resource) {
                                if (this.configManager.logStreamSteps) {
                                    logInfo(`ResourcePreparerTransform: push ${resource.id}`, {});
                                }
                                this.push(resource);
                            }
                        }
                    }
                }
            );
    }

    /**
     * @param {import('stream').TransformCallBack} callback
     * @private
     */
    _flush (callback) {
        if (this.configManager.logStreamSteps) {
            logInfo('ResourcePreparerTransform: _flush', {});
        }
        // https://nodejs.org/en/learn/asynchronous-work/dont-block-the-event-loop#partitioning
        // calling in setImmediate to process it in next iteration of event loop
        // and unblock other requests
        setImmediate(callback);
    }
}

module.exports = {
    ResourcePreparerTransform
};
