const {removeNull} = require('./nullRemover');
const {assertIsValid} = require('./assertType');
const {BaseResponseStreamer} = require('./baseResponseStreamer');

class FhirResponseStreamer extends BaseResponseStreamer {
    /**
     * constructor
     * @param {import('express').Response} response
     * @param {string} requestId
     */
    constructor(
        {
            response,
            requestId
        }
    ) {
        super({
            response, requestId
        });
        /**
         * @type {boolean}
         * @private
         */
        this._first = true;

        /**
         * @type {string | null}
         * @private
         */
        this._lastid = null;
    }

    /**
     * Starts response
     * @return {Promise<void>}
     */
    async startAsync() {
        const contentType = 'application/fhir+json';
        this.response.setHeader('Content-Type', contentType);
        this.response.setHeader('Transfer-Encoding', 'chunked');
        this.response.setHeader('X-Request-ID', String(this.requestId));

        const header = '{"entry":[';

        this.response.write(header);
    }

    /**
     * writes to response
     * @param {BundleEntry} bundleEntry
     * @return {Promise<void>}
     */
    async writeAsync({bundleEntry}) {
        if (bundleEntry !== null && bundleEntry !== undefined) {
            /**
             * @type {string}
             */
            const bundleEntryJson = JSON.stringify(bundleEntry.toJSON());
            assertIsValid(bundleEntry.resource, `BundleEntry does not have a resource element: ${bundleEntryJson}`);
            if (this._first) {
                // write the beginning json
                this._first = false;
                this.response.write(bundleEntryJson);
            } else {
                // add comma at the beginning to make it legal json
                this.response.write(',' + bundleEntryJson);
            }
            this._lastid = bundleEntry.resource.id;
        }
    }

    /**
     * ends response
     * @param {Bundle} bundle
     * @return {Promise<void>}
     */
    async endAsync({bundle}) {
        // noinspection JSUnresolvedFunction
        /**
         * @type {Object}
         */
        const cleanObject = removeNull(bundle.toJSON());
        /**
         * @type {string}
         */
        const bundleJson = JSON.stringify(cleanObject);

        // write ending json
        this.response.end('],' + bundleJson.substring(1));
    }
}

module.exports = {
    FhirResponseStreamer
};
