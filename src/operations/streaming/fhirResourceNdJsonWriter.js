const {Transform} = require('stream');

class FhirResourceNdJsonWriter extends Transform {
    /**
     * Streams the incoming data as json
     */
    constructor() {
        super({objectMode: true});
    }

    /**
     * transforms a chunk
     * @param {Object} chunk
     * @param {BufferEncoding} encoding
     * @param {CallableFunction} callback
     * @private
     */
    _transform(chunk, encoding, callback) {
        const resourceJson = JSON.stringify(chunk);
        this.push(resourceJson + '\n', encoding);
        callback();
    }

    _flush(callback) {
        // write ending json
        callback();
    }
}

module.exports = {
    FhirResourceNdJsonWriter: FhirResourceNdJsonWriter
};
