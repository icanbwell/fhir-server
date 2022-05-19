const {Transform} = require('stream');
const {prepareResourceAsync} = require('../common/resourcePreparer');

class ResourcePreparerTransform extends Transform {
    /**
     * Batches up objects to chunkSize before writing them to output
     * @param {string | null} user
     * @param {string | null} scope
     * @param {Object} args
     * @param {function(?Object): Resource} Resource
     * @param {string} resourceName
     * @param {boolean} useAccessIndex
     */
    constructor(user, scope, args, Resource, resourceName, useAccessIndex) {
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
        this.useAccessIndex = useAccessIndex;
    }

    /**
     * transforms a chunk
     * @param {Object} chunk
     * @param {import('stream').BufferEncoding} encoding
     * @param {import('stream').TransformCallBack} callback
     * @private
     */
    _transform(chunk, encoding, callback) {
        const chunks = Array.isArray(chunk) ? chunk : [chunk];

        for (const chunk1 of chunks) {
            prepareResourceAsync(this.user, this.scope, this.args, this.Resource, chunk1, this.resourceName, this.useAccessIndex).then(
                resources => {
                    if (resources.length > 0) {
                        for (const resource of resources) {
                            if (resource) {
                                this.push(resource);
                            }
                        }
                    }
                }
            ).then(callback());
        }

    }

    /**
     * @param {import('stream').TransformCallBack} callback
     * @private
     */
    _flush(callback) {
        callback();
    }
}

module.exports = {
    ResourcePreparerTransform: ResourcePreparerTransform
};
