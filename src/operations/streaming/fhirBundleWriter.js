const {Transform} = require('stream');
const {removeNull} = require('../../utils/nullRemover');

class FhirBundleWriter extends Transform {
    /**
     * Streams the incoming data inside a FHIR Bundle
     * @param {function (string[], number): Resource} fnBundle
     * @param {string | null} url
     */
    constructor(fnBundle, url) {
        super({objectMode: true});
        /**
         * @type {function(string[], number): Resource}
         * @private
         */
        this._fnBundle = fnBundle;
        this._url = url;
        this._first = true;
        this.push('{"entry":[');
        this._lastid = null;
    }

    /**
     * transforms a chunk
     * @param {Object} chunk
     * @param {import('stream').BufferEncoding} encoding
     * @param {import('stream').TransformCallBack} callback
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

    /**
     * @param {import('stream').TransformCallBack} callback
     * @private
     */
    _flush(callback) {
        /**
         * @type {number}
         */
        const stopTime = Date.now();

        /**
         * @type {Resource}
         */
        const bundle = this._fnBundle(this._lastid, stopTime);

        /**
         * @type {Object}
         */
        const cleanObject = removeNull(bundle.toJSON());
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
