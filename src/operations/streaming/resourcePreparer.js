const {Transform} = require('stream');
const {prepareResourceAsync} = require('../common/resourcePreparer');
const {isTrue} = require('../../utils/isTrue');
const env = require('var');

class ResourcePreparerTransform extends Transform {
    /**
     * Batches up objects to chunkSize before writing them to output
     * @param {string | null} user
     * @param {string | null} scope
     * @param {Object} args
     * @param {function(?Object): Resource} Resource
     * @param {string} resourceName
     * @param {boolean} useAccessIndex
     * @param {AbortSignal} signal
     */
    constructor(user, scope, args, Resource, resourceName, useAccessIndex, signal) {
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
         * @type {function(?Object): Resource}
         */
        this.Resource = Resource;
        /**
         * @type {string}
         */
        this.resourceName = resourceName;
        /**
         * @type {boolean}
         */
        this.useAccessIndex = useAccessIndex;
        /**
         * @type {AbortSignal}
         */
        this._signal = signal;
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
        const chunks = Array.isArray(chunk) ? chunk : [chunk];

        const promises = chunks.map(chunk1 =>
            this.processChunkAsync(chunk1)
        );
        Promise.all(promises).then(() => callback());
    }

    /**
     * processes a chunk
     * @param chunk1
     * @returns {Promise<Resource[]>}
     */
    processChunkAsync(chunk1) {
        return prepareResourceAsync(this.user, this.scope, this.args, this.Resource, chunk1,
            this.resourceName, this.useAccessIndex)
            .then(
                resources => {
                    if (isTrue(env.LOG_STREAM_STEPS)) {
                        console.log('ResourcePreparerTransform: _transform');
                    }
                    if (resources.length > 0) {
                        for (const resource of resources) {
                            if (resource) {
                                if (isTrue(env.LOG_STREAM_STEPS)) {
                                    console.log(`ResourcePreparerTransform: push ${resource['id']}`);
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
        if (isTrue(env.LOG_STREAM_STEPS)) {
            console.log('ResourcePreparerTransform: _flush');
        }
        callback();
    }
}

module.exports = {
    ResourcePreparerTransform: ResourcePreparerTransform
};
