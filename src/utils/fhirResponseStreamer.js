const moment = require('moment-timezone');
const { assertIsValid } = require('./assertType');
const { BaseResponseStreamer } = require('./baseResponseStreamer');
const Bundle = require('../fhir/classes/4_0_0/resources/bundle');
const { FhirResourceSerializer } = require('../fhir/fhirResourceSerializer');
const BundleEntrySerializer = require('../fhir/serializers/4_0_0/backbone_elements/bundleEntry');
const BundleSerializer = require('../fhir/serializers/4_0_0/resources/bundle');

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
         * @type {string}
         * @private
         */
        this._beginningJSON = '{"entry":[';

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

        /**
         * @type {Bundle|null}
         * @private
         */
        this._bundle = null;
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
    }

    /**
     * writes to response
     * @param {BundleEntry} bundleEntry
     * @return {Promise<void>}
     */
    async writeBundleEntryAsync({ bundleEntry }) {
        if (bundleEntry !== null && bundleEntry !== undefined) {
            FhirResourceSerializer.serialize(bundleEntry, BundleEntrySerializer);
            /**
             * @type {string}
             */
            const bundleEntryJson = JSON.stringify(bundleEntry);
            assertIsValid(bundleEntry.resource, `BundleEntry does not have a resource element: ${bundleEntryJson}`);
            if (this._first) {
                // write the beginning json
                this._first = false;
                await this.response.write(this._beginningJSON + bundleEntryJson);
            } else {
                // add comma at the beginning to make it legal json
                await this.response.write(',' + bundleEntryJson);
            }
            this._count += 1;
            this._lastid = bundleEntry.resource.id;
        }
    }

    /**
     * sets the bundle to use
     * @param {Bundle} bundle
     */
    setBundle({ bundle }) {
        this._bundle = bundle;
    }

    /**
     * ends response
     * @return {Promise<void>}
     */
    async endAsync() {
        const emptyBundle = () => {
            return {
                id: this.requestId,
                type: this._bundleType,
                timestamp: moment.utc().format('YYYY-MM-DDThh:mm:ss.sss') + 'Z',
                resourceType: 'Bundle'
            };
        };

        const bundle = this._bundle || emptyBundle();
        bundle.total = this._count;
        // noinspection JSUnresolvedFunction
        /**
         * @type {Object}
         */
        const cleanObject = FhirResourceSerializer.serialize(bundle, BundleSerializer);
        /**
         * @type {string}
         */
        const bundleJson = JSON.stringify(cleanObject);

        if (this._first) {
            // write the beginning json
            this._first = false;
            await this.response.write(this._beginningJSON);
        }

        // write ending json
        await this.response.end('],' + bundleJson.substring(1));
    }
}

module.exports = {
    FhirResponseStreamer
};
