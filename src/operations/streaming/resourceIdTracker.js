const {Transform} = require('stream');

class ResourceIdTracker extends Transform {
    /**
     * Tracks the ids of the objects flowing through the stream
     * @param  {{id: string[]}} tracker
     */
    constructor(tracker) {
        super({objectMode: true});
        /**
         * @type {{id: string[]}}
         * @private
         */
        this._tracker = tracker;
        this._tracker.id = [];
    }

    /**
     * transforms a chunk
     * @param {Object} chunk
     * @param {import('stream').BufferEncoding} encoding
     * @param {import('stream').TransformCallBack} callback
     * @private
     */
    _transform(chunk, encoding, callback) {
        if (chunk !== null && chunk !== undefined) {
            this._tracker.id.push(chunk['id']);
            this.push(chunk, encoding);
        }
        callback();
    }
}

module.exports = {
    ResourceIdTracker: ResourceIdTracker
};
