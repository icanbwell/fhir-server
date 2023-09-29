const {Transform} = require('stream');
const {logInfo} = require('../common/logging');
const {assertTypeEquals} = require('../../utils/assertType');
const {ConfigManager} = require('../../utils/configManager');
const {RethrownError} = require('../../utils/rethrownError');
const {convertErrorToOperationOutcome} = require('../../utils/convertErrorToOperationOutcome');

class ResourcePreparerTransform extends Transform {
    /**
     * Batches up objects to chunkSize before writing them to output
     * @param {string | null} user
     * @param {string | null} scope
     * @param {ParsedArgs} parsedArgs
     * @param {string} resourceType
     * @param {boolean} useAccessIndex
     * @param {AbortSignal} signal
     * @param {ResourcePreparer} resourcePreparer
     * @param {number} highWaterMark
     * @param {ConfigManager} configManager
     */
    constructor(
        {
            user,
            scope,
            parsedArgs,
            resourceType,
            useAccessIndex,
            signal,
            resourcePreparer,
            highWaterMark,
            configManager
        }
    ) {
        super({objectMode: true, highWaterMark: highWaterMark});
        /**
         * @type {string|null}
         */
        this.user = user;
        /**
         * @type {string|null}
         */
        this.scope = scope;
        /**
         * @type {ParsedArgs}
         */
        this.parsedArgs = parsedArgs;
        /**
         * @type {string}
         */
        this.resourceName = resourceType;
        /**
         * @type {boolean}
         */
        this.useAccessIndex = useAccessIndex;
        /**
         * @type {AbortSignal}
         */
        this._signal = signal;
        /**
         * @type {ResourcePreparer}
         */
        this.resourcePreparer = resourcePreparer;

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
    _transform(chunk, encoding, callback) {
        if (this._signal.aborted) {
            callback();
            return;
        }
        try {
            const chunks = Array.isArray(chunk) ? chunk : [chunk];

            /**
             * @type {Promise<Resource[]>[]}
             */
            const promises = chunks.map(chunk1 =>
                this.processChunkAsync(chunk1)
            );
            Promise.all(promises).then(() => callback()).catch(
                (reason) => {
                    throw new RethrownError(
                        {
                            message: `ResourcePreparer _transform: error: ${reason}. id: ${chunk.id}`,
                            args: {
                                id: chunk.id,
                                chunk: chunk,
                                reason: reason,
                                message: reason?.message,
                                stack: reason?.stack,
                            },
                            error: reason
                        }
                    );
                });
        } catch (e) {
            const error = new RethrownError(
                {
                    message: `ResourcePreparer _transform: error: ${e.message}. id: ${chunk.id}`,
                    error: e,
                    args: {
                        id: chunk.id,
                        chunk: chunk
                    }
                }
            );
            /**
             * @type {OperationOutcome}
             */
            const operationOutcome = convertErrorToOperationOutcome({
                error: error
            });
            this.push(operationOutcome);
            callback();
        }
    }

    /**
     * processes a chunk
     * @param chunk1
     * @returns {Promise<Resource[]>}
     */
    async processChunkAsync(chunk1) {
        return this.resourcePreparer.prepareResourceAsync(
            {
                user: this.user, scope: this.scope, parsedArgs: this.parsedArgs, element: chunk1,
                resourceType: this.resourceName, useAccessIndex: this.useAccessIndex
            })
            .then(
                /** @type {Resource[]} */resources => {
                    if (resources.length > 0) {
                        for (const /** @type {Resource} */ resource of resources) {
                            if (resource) {
                                if (this.configManager.logStreamSteps) {
                                    logInfo(`ResourcePreparerTransform: push ${resource['id']}`, {});
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
    _flush(callback) {
        if (this.configManager.logStreamSteps) {
            logInfo('ResourcePreparerTransform: _flush', {});
        }
        callback();
    }
}

module.exports = {
    ResourcePreparerTransform
};
