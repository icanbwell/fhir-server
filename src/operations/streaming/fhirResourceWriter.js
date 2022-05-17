const {Transform} = require('stream');

class FhirResourceWriter extends Transform {
    /**
     * Streams the incoming data as json
     */
    constructor() {
        super({objectMode: true});
        this._first = true;
        this.push('[');
    }

    /**
     * transforms a chunk
     * @param {Object} chunk
     * @param {import('stream').BufferEncoding} encoding
     * @param {import('stream').TransformCallBack} callback
     * @private
     */
    _transform(chunk, encoding, callback) {
        const resourceJson = JSON.stringify(chunk);
        if (this._first) {
            // write the beginning json
            this._first = false;
            this.push(resourceJson, encoding);
        } else {
            // add comma at the beginning to make it legal json
            this.push(',' + resourceJson, encoding);
        }
        callback();
    }

    /**
     * @param {import('stream').TransformCallBack} callback
     * @private
     */
    _flush(callback) {
        // write ending json
        this.push(']');
        callback();
    }
}

module.exports = {
    FhirResourceWriter: FhirResourceWriter
};
