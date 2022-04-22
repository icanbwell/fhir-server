const {Writable} = require('stream');

class StreamToArrayWriter extends Writable {
    /**
     * writes stream to the passed in array
     * @param {Object[]} buffer
     */
    constructor(buffer) {
        super({objectMode: true});
        /**
         * buffer
         * @type {Object[]}
         * @private
         */
        this._buffer = buffer;
    }

    _write(chunk, encoding, callback) {
        for (const item of chunk) {
            this._buffer.push(item);
        }
        callback();
    }

    _final(callback) {
        this.push(this._buffer);
        callback();
    }

    getArray() {
        return this._buffer;
    }
}

module.exports = {
    StreamToArrayWriter: StreamToArrayWriter
};
