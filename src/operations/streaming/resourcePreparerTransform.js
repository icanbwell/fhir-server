const {Transform} = require('stream');
const {isTrue} = require('../../utils/isTrue');
const env = require('var');
const {ResourceWithSecurityTagStructure} = require('../common/resourceWithSecurityTagStructure');

class ResourcePreparerTransform extends Transform {
    /**
     * Batches up objects to chunkSize before writing them to output
     * @param {string | null} user
     * @param {string | null} scope
     * @param {Object} args
     * @param {string} resourceType
     * @param {boolean} useAccessIndex
     * @param {AbortSignal} signal
     * @param {ResourcePreparer} resourcePreparer
     * @param {Object} originalArgs
     */
    constructor(
        {
            user,
            scope,
            args,
            resourceType,
            useAccessIndex,
            signal,
            resourcePreparer,
            originalArgs
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
         * @type {Object}
         */
        this.args = args;
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
         * @type {Object}
         */
        this.originalArgs = originalArgs;

        /**
         * what resources have we already processed
         * @type {ResourceWithSecurityTagStructure[]}
         */
        this.resourcesProcessed = [];
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
                    throw new AggregateError([reason], 'ResourcePreparer _transform: error');
                });
        } catch (e) {
            throw new AggregateError([e], 'ResourcePreparer _transform: error');
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
                user: this.user, scope: this.scope, args: this.args, element: chunk1,
                resourceType: this.resourceName, useAccessIndex: this.useAccessIndex,
                originalArgs: this.originalArgs
            })
            .then(
                /** @type {Resource[]} */resources => {
                    if (isTrue(env.LOG_STREAM_STEPS)) {
                        console.log(JSON.stringify({message: 'ResourcePreparerTransform: _transform'}));
                    }
                    if (resources.length > 0) {
                        for (const /** @type {Resource} */ resource of resources) {
                            /**
                             * @type {ResourceWithSecurityTagStructure}
                             */
                            const resourceWithSecurityTagStructure = new ResourceWithSecurityTagStructure({
                                resource
                            });
                            // Remove any duplicates
                            if (resource &&
                                !this.resourcesProcessed.some(a =>
                                    resourceWithSecurityTagStructure.isSameResourceByIdAndSecurityTag({other: a})
                                )
                            ) {
                                if (isTrue(env.LOG_STREAM_STEPS)) {
                                    console.log(JSON.stringify({message: `ResourcePreparerTransform: push ${resource['id']}`}));
                                }
                                this.push(resource);
                                this.resourcesProcessed.push(
                                    new ResourceWithSecurityTagStructure(
                                        {resource}
                                    )
                                );
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
            console.log(JSON.stringify({message: 'ResourcePreparerTransform: _flush'}));
        }
        callback();
    }
}

module.exports = {
    ResourcePreparerTransform
};
