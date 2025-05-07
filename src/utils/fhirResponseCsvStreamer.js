const {FhirResourceSerializer} = require('../fhir/fhirResourceSerializer');
const {BaseResponseStreamer} = require('./baseResponseStreamer');
const {fhirContentTypes} = require('./contentTypes');
const {FHIRBundleConverter} = require("@imranq2/fhir-to-csv/lib/converters/fhir_bundle_converter");
var JSZip = require("jszip");
const {ExtractorRegistrar} = require("@imranq2/fhir-to-csv/lib/converters/register");

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
        this.response.setHeader('Content-Disposition', `attachment; filename="fhir_export_${new Date().toISOString().replace(/:/g, '-')}.zip"`);
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
            ExtractorRegistrar.registerAll();

            if (this._bundle !== undefined && (this._bundle.entry || this._bundle_entries.length > 0)) {
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
                // Now extract the data as dictionaries
                const extractedData = await converter.convertToDictionaries(bundle);
                /**
                 * @type {Buffer<ArrayBufferLike>}
                 */
                const zipBuffer = await converter.convertToCSVZipped(
                    extractedData
                );

                // Verify buffer before sending
                if (zipBuffer.length === 0) {
                    throw new Error('Generated zip buffer is empty');
                }

                // write the buffer to response
                this.response.setHeader('Content-Length', zipBuffer.length);

                // Write entire zip file to response
                // this.response.write(zipBuffer);
                this.response.end(zipBuffer);
            } else {
                await this.response.end();
            }
        } catch (error) {
            console.error('Error generating FHIR CSV export:', error);
            this.response.status(500).send('Failed to generate FHIR CSV export');
        }

    }
}

module.exports = {
    FhirResponseCsvStreamer
};
