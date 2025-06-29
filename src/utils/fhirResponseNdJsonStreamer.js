const { FhirResourceSerializer } = require('../fhir/fhirResourceSerializer');
const BundleEntrySerializer = require('../fhir/serializers/4_0_0/backbone_elements/bundleEntry');
const { BaseResponseStreamer } = require('./baseResponseStreamer');
const { fhirContentTypes } = require('./contentTypes');

class FhirResponseNdJsonStreamer extends BaseResponseStreamer {
    /**
     * constructor
     * @param {import('express').Response} response
     * @param {string} requestId
     */
    constructor({ response, requestId }) {
        super({
            response,
            requestId
        });
        /**
         * @type {boolean}
         * @private
         */
        this._first = true;

        /**
         * @type {number}
         * @private
         */
        this._count = 0;
    }

    /**
     * Starts response
     * @return {Promise<void>}
     */
    async startAsync() {
        const contentType = fhirContentTypes.ndJson;
        this.response.setHeader('Content-Type', contentType);
        this.response.setHeader('Transfer-Encoding', 'chunked');
        this.response.setHeader('X-Request-ID', String(this.requestId));
    }

    /**
     * writes to response
     * @param {BundleEntry} bundleEntry
     * @return {Promise<void>}
     */
    async writeBundleEntryAsync({ bundleEntry }) {
        if (bundleEntry !== null && bundleEntry !== undefined) {
            /**
             * @type {Resource}
             */
            let resource = bundleEntry.resource;
            if (resource !== null && resource !== undefined) {
                FhirResourceSerializer.serialize(resource);
                /**
                 * @type {string}
                 */
                const resourceJson = JSON.stringify(resource);
                if (this._first) {
                    // write the beginning json
                    this._first = false;
                    await this.response.write(resourceJson);
                } else {
                    // add \n at the beginning to make it legal ndjson
                    await this.response.write('\n' + resourceJson);
                }
                this._count += 1;
            }
        }
    }
    /**
     * ends response
     * @return {Promise<void>}
     */
    async endAsync() {
        // write ending json
        await this.response.end('');
    }
}

module.exports = {
    FhirResponseNdJsonStreamer
};
