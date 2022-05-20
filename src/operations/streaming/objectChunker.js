const {Transform} = require('stream');

class ObjectChunker extends Transform {
    /**
     * Batches up objects to chunkSize before writing them to output
     * @param {number} chunkSize
     */
    constructor(chunkSize) {
        super({objectMode: true});
        this._buffer = [];
        this._chunkSize = chunkSize;
    }

    /**
     * transforms a chunk
     * @param {Object} chunk
     * @param {import('stream').BufferEncoding} encoding
     * @param {import('stream').TransformCallBack} callback
     * @private
     */
    _transform(chunk, encoding, callback) {
        if (this._buffer.length === this._chunkSize) {
            this.push(this._buffer);
            this._buffer = [];
        }
        this._buffer.push(chunk);
        callback();
    }

    /**
     * @param {import('stream').TransformCallBack} callback
     * @private
     */
    _flush(callback) {
        this.push(this._buffer);
        callback();
    }
}

module.exports = {
    ObjectChunker: ObjectChunker
};
