const {removeNull} = require('./nullRemover');
const {assertIsValid} = require('./assertType');
const {BaseResponseStreamer} = require('./baseResponseStreamer');
const Bundle = require('../fhir/classes/4_0_0/resources/bundle');

class FhirResponseStreamer extends BaseResponseStreamer {
    /**
     * constructor
     * @param {import('express').Response} response
     * @param {string} requestId
     * @param {string} bundleType
     */
    constructor(
        {
            response,
            requestId,
            bundleType = 'searchset'
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

        /**
         * @type {number}
         * @private
         */
        this._count = 0;

        /**
         * @type {string}
         * @private
         */
        this._bundleType = bundleType;
        assertIsValid(bundleType, 'bundleType is not set');
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

        await this.response.write(header);
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
                await this.response.write(bundleEntryJson);
            } else {
                // add comma at the beginning to make it legal json
                await this.response.write(',' + bundleEntryJson);
            }
            this._count = this._count + 1;
            this._lastid = bundleEntry.resource.id;
        }
    }

    /**
     * ends response
     * @return {Promise<void>}
     */
    async endAsync() {
        const bundle = new Bundle({
            id: this.requestId,
            type: this._bundleType,
            total: this._count
        });
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
        await this.response.end('],' + bundleJson.substring(1));
    }
}

module.exports = {
    FhirResponseStreamer
};
