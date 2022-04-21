const {Transform} = require('stream');
const {removeNull} = require('../../utils/nullRemover');

class FhirBundleWriter extends Transform {
    /**
     * Streams the incoming data inside a FHIR Bundle
     * @param {Resource} bundle
     */
    constructor(bundle) {
        super({objectMode: true});
        /**
         * @type {Resource}
         * @private
         */
        this._bundle = bundle;
        this._first = true;
        this.push('{"entry":[');
        this._lastid = null;
    }

    /**
     * transforms a chunk
     * @param {Object} chunk
     * @param {BufferEncoding} encoding
     * @param {CallableFunction} callback
     * @private
     */
    _transform(chunk, encoding, callback) {
        const resourceJson = JSON.stringify(
            {
                resource: chunk
            }
        );
        if (this._first) {
            // write the beginning json
            this._first = false;
            this.push(resourceJson, encoding);
        } else {
            // add comma at the beginning to make it legal json
            this.push(',' + resourceJson, encoding);
        }
        this._lastid = chunk['id'];
        callback();
    }

    _flush(callback) {
        /**
         * @type {Object}
         */
        const cleanObject = removeNull(this._bundle.toJSON());
        /**
         * @type {string}
         */
        const bundleJson = JSON.stringify(cleanObject);

        // write ending json
        this.push('],' + bundleJson.substring(1)); // skip the first }
        callback();
    }
}

module.exports = {
    FhirBundleWriter: FhirBundleWriter
};
