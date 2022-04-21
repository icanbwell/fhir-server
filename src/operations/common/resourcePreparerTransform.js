const {Transform} = require('stream');
const {prepareResource} = require('./resourcePreparer');

class ResourcePreparerTransform extends Transform {
    /**
     * Create a transform to prepare resources passed to it
     * @param {string | null} user
     * @param {string | null} scope
     * @param {Object?} args
     * @param {CallableFunction} Resource
     * @param {string} resourceName
     */
    constructor(user, scope, args, Resource, resourceName) {
        super({objectMode: true});
        /**
         * buffer
         * @type {Object[][]}
         * @private
         */
        this._buffer = [];
        this._user = user;
        this._scope = scope;
        this._args = args;
        this.Resource = Resource;
        this._resourceName = resourceName;
    }

    /**
     * transforms a chunk
     * @param {Object} chunk
     * @param {string} encoding
     * @param {CallableFunction} callback
     * @private
     */
    _transform(chunk, encoding, callback) {
        prepareResource(this._user, this._scope, this._args, this.Resource, chunk, this._resourceName)
            .then(preparedResources => {
                this._buffer.push(preparedResources);
                callback();
            });
    }

    _flush(callback) {
        this.push(this._buffer.flatMap(a => a));
        callback();
    }
}

module.exports = {
    ResourcePreparerTransform: ResourcePreparerTransform
};
