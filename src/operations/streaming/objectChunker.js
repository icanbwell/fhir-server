const {Transform} = require('stream');
const {isTrue} = require('../../utils/isTrue');
const env = require('var');
const {logInfo} = require('../common/logging');

class ObjectChunker extends Transform {
    /**
     * Batches up objects to chunkSize before writing them to output
     * @param {number} chunkSize
     * @param {AbortSignal} signal
     */
    constructor({chunkSize, signal}) {
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
        try {
            const chunks = Array.isArray(chunk) ? chunk : [chunk];

            for (const chunk1 of chunks) {
                if (this._chunkSize === 0 || this._buffer.length === this._chunkSize) {
                    if (isTrue(env.LOG_STREAM_STEPS)) {
                        logInfo('ObjectChunker: _transform: write buffer to output');
                    }
                    this.push(this._buffer);
                    this._buffer = [];
                }
                this._buffer.push(chunk1);
            }
        } catch (e) {
            throw new AggregateError([e], 'ObjectChunker _transform: error');
        }
        callback();
    }

    /**
     * @param {import('stream').TransformCallBack} callback
     * @private
     */
    _flush(callback) {
        if (isTrue(env.LOG_STREAM_STEPS)) {
            logInfo('ObjectChunker: _flush');
        }
        try {
            if (this._buffer.length > 0) {
                this.push(this._buffer);
            }
        } catch (e) {
            throw new AggregateError([e], 'ObjectChunker _flush: error');
        }
        callback();
    }
}

module.exports = {
    ObjectChunker
};
