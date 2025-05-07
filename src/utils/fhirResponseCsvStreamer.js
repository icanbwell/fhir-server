const {FhirResourceSerializer} = require('../fhir/fhirResourceSerializer');
const {BaseResponseStreamer} = require('./baseResponseStreamer');
const {fhirContentTypes} = require('./contentTypes');
const {FHIRBundleConverter} = require("@imranq2/fhir-to-csv/lib/converters/fhir_bundle_converter");
var JSZip = require("jszip");

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
        try {
            if (this._bundle === undefined) {
                throw new Error('No bundle available for export');
            }

            const converter = new FHIRBundleConverter();
            const bundle = this._bundle.toJSON();

            const extractedData = await converter.convertToDictionaries(bundle);
            const csvRowsByResourceType = await converter.convertToCSV(extractedData);

            const zip = new JSZip();

            // Add each CSV to the zip file
            for (const [resourceType, csvRows] of Object.entries(csvRowsByResourceType)) {
                const csvContent = csvRows.join('\n');
                zip.file(`${resourceType}.csv`, csvContent);
            }

            // Generate zip file as a buffer
            const zipBuffer = await zip.generateAsync({ type: 'nodebuffer' });

            // Write entire zip file to response
            this.response.write(zipBuffer);
            this.response.end();

        } catch (error) {
            console.error('Error generating FHIR CSV export:', error);
            this.response.status(500).send('Failed to generate FHIR CSV export');
        }
        // write ending json
        await this.response.end();
    }
}

module.exports = {
    FhirResponseCsvStreamer
};
