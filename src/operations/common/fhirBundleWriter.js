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
        const cleanObject = removeNull(bundle.toJSON());
        cleanObject['entry'] = [];
        /**
         * @type {string}
         */
        this.bundleJson = JSON.stringify(cleanObject);
        const strings = this.bundleJson.split('entry":[');
        this._beginningJson = strings[0] + 'entry":[';
        this._endingJson = strings[1];
        this._first = true;
        this.push(this._beginningJson);
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
        callback();
    }

    _flush(callback) {
        // write ending json
        this.push(this._endingJson);
        callback();
    }
}

module.exports = {
    FhirBundleWriter: FhirBundleWriter
};
