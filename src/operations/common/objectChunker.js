const {Transform} = require('stream');

class ObjectChunker extends Transform {
    constructor(chunkSize) {
        super({objectMode: true});
        this._buffer = [];
        this._chunkSize = chunkSize;
    }

    _transform(chunk, encoding, callback) {
        if (this._buffer.length === this._chunkSize) {
            this.push(this._buffer);
            this._buffer = [];
        }
        this._buffer.push(chunk);
        callback();
    }

    _flush(callback) {
        this.push(this._buffer);
        callback();
    }
}

module.exports = {
    ObjectChunker: ObjectChunker
};
