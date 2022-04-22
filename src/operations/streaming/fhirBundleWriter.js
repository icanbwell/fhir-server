const {Transform} = require('stream');
const {removeNull} = require('../../utils/nullRemover');

class FhirBundleWriter extends Transform {
    /**
     * Streams the incoming data inside a FHIR Bundle
     * @param {Resource} bundle
     * @param {string | null} url
     * @param {number} startTime
     */
    constructor(bundle, url, startTime) {
        super({objectMode: true});
        /**
         * @type {Resource}
         * @private
         */
        this._bundle = bundle;
        this._url = url;
        this._first = true;
        this.push('{"entry":[');
        this._lastid = null;
        this._startTime = startTime;
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

        // update the "next" link
        if (this._lastid) {
            // have to use a base url or URL() errors
            const baseUrl = 'https://example.org';
            /**
             * url to get next page
             * @type {URL}
             */
            const nextUrl = new URL(this._url, baseUrl);
            // add or update the id:above param
            nextUrl.searchParams.set('id:above', `${this._lastid}`);
            // remove the _getpagesoffset param since that will skip again from this id
            nextUrl.searchParams.delete('_getpagesoffset');
            cleanObject.link.push({
                relation: 'next',
                url: `${nextUrl.toString().replace(baseUrl, '')}`,
            });
            /**
             * @type {number}
             */
            const stopTime = Date.now();

            // set end time
            const queryTimeTag = cleanObject.meta.tag.find(t => t.system === 'https://www.icanbwell.com/queryTime');
            if (queryTimeTag) {
                queryTimeTag['display'] = `${(stopTime - this._startTime) / 1000}`;
            }
        }
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
