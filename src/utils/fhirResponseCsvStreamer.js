const {FhirResourceSerializer} = require('../fhir/fhirResourceSerializer');
const {BaseResponseStreamer} = require('./baseResponseStreamer');
const {fhirContentTypes} = require('./contentTypes');
const {FHIRBundleConverter} = require("@imranq2/fhir-to-csv/lib/fhir_bundle_converter");
const {BundleToExcelConverter} = require("../converters/bundleToExcelConverter");
const {BundleToCsvConverter} = require("../converters/bundleToCsvConverter");
const {BufferToChunkTransferResponse} = require("./buffer_to_chunk_transfer_response");

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
        this._bundle = undefined;

        /**
         * store the bundle entries
         * @type {BundleEntry[]}
         * @private
         */
        this._bundle_entries = [];
    }

    /**
     * Starts response
     * @return {Promise<void>}
     */
    async startAsync() {
        const contentType = fhirContentTypes.zip;
        this.response.setHeader('Content-Type', contentType);
        this.response.setHeader('X-Request-ID', String(this.requestId));
    }

    /**
     * writes to response
     * @param {BundleEntry} bundleEntry
     * @param {boolean} rawResources
     * @return {Promise<void>}
     */
    async writeBundleEntryAsync({bundleEntry, rawResources = false}) {
        this._bundle_entries.push(bundleEntry);
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
        try {
            if (this._bundle !== undefined && (this._bundle.entry || this._bundle_entries.length > 0)) {
                const filename = (this._bundle.id || String(this.RequestId)) + '.zip';
                this.response.setHeader(
                    'Content-Disposition',
                    `attachment; filename="${filename}"`
                );
                this.response.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');
                /**
                 * @type {FHIRBundleConverter}
                 */
                const converter = new FHIRBundleConverter();
                /**
                 * @type {Object}
                 */
                let bundle = this._bundle.toJSON();
                if (this._bundle_entries.length > 0) {
                    /**
                     * @type {Bundle}
                     */
                    const bundle_copy = this._bundle.clone();
                    bundle_copy.entry = this._bundle_entries;
                    /**
                     * @type {Object}
                     */
                    bundle = bundle_copy.toJSON();
                }

                /**
                 * @type {BundleToCsvConverter}
                 */
                const exporter = new BundleToCsvConverter();
                /**
                 * @type {Buffer}
                 */
                const csvBuffer = exporter.convert(
                    {
                        bundle
                    }
                );
                // Verify buffer before sending
                if (csvBuffer.length === 0) {
                    throw new Error('Generated zip buffer is empty');
                }

                await new BufferToChunkTransferResponse().sendLargeFileChunked(
                    {
                        response: this.response,
                        buffer: csvBuffer,
                        chunkSize: 64 * 1024
                    }
                );
            } else {
                await this.response.end();
            }
        } catch (error) {
            console.error('Error generating FHIR CSV export:', error);
            this.response.end();
        }

    }
}

module.exports = {
    FhirResponseCsvStreamer
};
