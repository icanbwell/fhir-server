const {removeNull} = require('./nullRemover');
const {assertIsValid} = require('./assertType');

class FhirResponseStreamer {
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
        /**
         * @type {import('express').Response}
         */
        this.response = response;
        assertIsValid(response);
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

        /**
         * @type {string}
         */
        this.requestId = requestId;
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
     * @param {Resource} resource
     * @return {Promise<void>}
     */
    async writeAsync({resource}) {
        if (resource !== null && resource !== undefined) {
            /**
             * @type {string}
             */
            const resourceJson = JSON.stringify(resource.toJSON());
            if (this._first) {
                // write the beginning json
                this._first = false;
                this.response.write(resourceJson);
            } else {
                // add comma at the beginning to make it legal json
                this.response.write(',' + resourceJson);
            }
            this._lastid = resource['id'];
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
