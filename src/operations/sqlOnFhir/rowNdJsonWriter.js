const { Transform } = require('stream');

/**
 * Transform stream that converts plain row objects (SQL-on-FHIR $run output
 * rows, NOT FHIR resources) into newline-delimited JSON bytes.
 *
 * Writable side is objectMode (accepts row objects); readable side emits
 * Buffers/strings of `JSON.stringify(row) + '\n'`.
 */
class RowNdJsonWriter extends Transform {
    constructor(options = {}) {
        super({ ...options, writableObjectMode: true, readableObjectMode: false });
    }

    _transform(row, _encoding, callback) {
        try {
            this.push(JSON.stringify(row) + '\n');
            callback();
        } catch (err) {
            callback(err);
        }
    }
}

module.exports = { RowNdJsonWriter };
