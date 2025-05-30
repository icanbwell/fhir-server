const { Transform } = require('stream');

class NdjsonParser extends Transform {
    constructor() {
        super({ readableObjectMode: true, writableObjectMode: false });
        this._buffer = '';
    }

    _transform(chunk, encoding, callback) {
        this._buffer += chunk.toString();

        let lines = this._buffer.split('\n');
        this._buffer = lines.pop(); // leave incomplete line in buffer

        for (const line of lines) {
            if (line.trim()) {
                try {
                    this.push(JSON.parse(line));
                } catch (e) {
                    // handle malformed JSON line
                    return callback(new Error(`Invalid NDJSON: ${e.message}`));
                }
            }
        }
        callback();
    }

    _flush(callback) {
        if (this._buffer.trim()) {
            try {
                this.push(JSON.parse(this._buffer));
            } catch (e) {
                return callback(new Error(`Invalid NDJSON on flush: ${e.message}`));
            }
        }
        callback();
    }
}

module.exports = {
    NdjsonParser
};

