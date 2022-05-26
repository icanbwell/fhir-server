const {Transform} = require('stream');
const {isTrue} = require('../../utils/isTrue');
const env = require('var');

class ObjectChunker extends Transform {
    /**
     * Batches up objects to chunkSize before writing them to output
     * @param {number} chunkSize
     * @param {AbortSignal} signal
     */
    constructor(chunkSize, signal) {
        super({objectMode: true});
        this._buffer = [];
        this._chunkSize = chunkSize;
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

        for (const chunk1 of chunks) {
            if (this._buffer.length === this._chunkSize) {
                this.push(this._buffer);
                this._buffer = [];
            }
            this._buffer.push(chunk1);
        }
        callback();
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
    ObjectChunker: ObjectChunker
};
