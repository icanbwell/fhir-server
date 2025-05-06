const {FhirResourceSerializer} = require('../fhir/fhirResourceSerializer');
const {BaseResponseStreamer} = require('./baseResponseStreamer');
const {fhirContentTypes} = require('./contentTypes');
const {FHIRBundleConverter} = require('@imranq2/fhir-to-csv');

class FhirResponseCsvStreamer extends BaseResponseStreamer {
    /**
     * constructor
     * @param {import('express').Response} response
     * @param {string} requestId
     */
    constructor({response, requestId}) {
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

        /**
         * store the bundle
         * @type {Bundle|undefined}
         */
        this._bundle = undefined
    }

    /**
     * Starts response
     * @return {Promise<void>}
     */
    async startAsync() {
        const contentType = fhirContentTypes.csv;
        this.response.setHeader('Content-Type', contentType);
        this.response.setHeader('Transfer-Encoding', 'chunked');
        this.response.setHeader('X-Request-ID', String(this.requestId));
    }

    /**
     * writes to response
     * @param {BundleEntry} bundleEntry
     * @param {boolean} rawResources
     * @return {Promise<void>}
     */
    async writeBundleEntryAsync({bundleEntry, rawResources = false}) {
        // nothing to do since we write the whole bundle
    }

    /**
     * sets the bundle to use
     * @param {Bundle} bundle
     * @param {boolean} rawResources
     */
    setBundle({bundle, rawResources = false}) {
        this._bundle = bundle;
    }

    /**
     * ends response
     * @return {Promise<void>}
     */
    async endAsync() {
        // now write each resourceType in the bundle
        if (this._bundle !== undefined) {
            /**
             * @type {Record<string, Record<string, any[]>>}
             */
            const extractedData = await FHIRBundleConverter.convertToDictionaries(
                this._bundle
            );
            /**
             * @type {NodeJS.ReadableStream}
             */
            const csvStream = await FHIRBundleConverter.convertToCSVZipped(extractedData);
            /**
             * @type {import('express').Response}
             */
            const response = this.response;
            // read from csvStream and write to response
            csvStream.on('data', (chunk) => {
                response.write(chunk);
            });
        }
        // write ending json
        await this.response.end();
    }
}

module.exports = {
    FhirResponseCsvStreamer
};
