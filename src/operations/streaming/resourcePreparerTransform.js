const {Transform} = require('stream');
const {isTrue} = require('../../utils/isTrue');
const env = require('var');
const {logInfo} = require('../common/logging');

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
     * @param {boolean|undefined} removeDuplicates
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
            removeDuplicates
        }
    ) {
        super({objectMode: true});
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
         * what resources have we already processed
         * @type {{resourceType: string, _uuid: string, id: string, securityTagStructure: SecurityTagStructure}[]}
         */
        this.resourcesProcessed = [];

        /**
         * @type {boolean|undefined}
         */
        this.removeDuplicates = removeDuplicates;
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
                    throw new AggregateError([reason], `ResourcePreparer _transform: error: ${reason}`);
                });
        } catch (e) {
            throw new AggregateError([e], `ResourcePreparer _transform: error: ${e}`);
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
                    if (isTrue(env.LOG_STREAM_STEPS)) {
                        logInfo('ResourcePreparerTransform: _transform', {});
                    }
                    if (resources.length > 0) {
                        for (const /** @type {Resource} */ resource of resources) {
                            // Remove any duplicates
                            if (resource && this.removeDuplicates &&
                                !this.resourcesProcessed.some(a =>
                                    resource.isSameResourceByIdAndSecurityTag({other: a})
                                )
                            ) {
                                if (isTrue(env.LOG_STREAM_STEPS)) {
                                    logInfo(`ResourcePreparerTransform: push ${resource['id']}`, {});
                                }
                                this.push(resource.toJSON());
                                if (this.removeDuplicates) {
                                    this.resourcesProcessed.push(
                                        {
                                            resourceType: resource.resourceType,
                                            _uuid: resource._uuid,
                                            id: resource.id,
                                            securityTagStructure: resource.securityTagStructure
                                        }
                                    );
                                }
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
        if (isTrue(env.LOG_STREAM_STEPS)) {
            logInfo('ResourcePreparerTransform: _flush', {});
        }
        callback();
    }
}

module.exports = {
    ResourcePreparerTransform
};
