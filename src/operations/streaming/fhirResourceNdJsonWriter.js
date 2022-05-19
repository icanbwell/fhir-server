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
     * @param {import('stream').BufferEncoding} encoding
     * @param {import('stream').TransformCallBack} callback
     * @private
     */
    _transform(chunk, encoding, callback) {
        if (chunk !== null && chunk !== undefined) {
            const resourceJson = JSON.stringify(chunk);
            this.push(resourceJson + '\n', encoding);
        }
        callback();
    }

    /**
     * @param {import('stream').TransformCallBack} callback
     * @private
     */
    _flush(callback) {
        callback();
    }
}

module.exports = {
    FhirResourceNdJsonWriter: FhirResourceNdJsonWriter
};
