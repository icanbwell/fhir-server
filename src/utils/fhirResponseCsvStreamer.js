const {BaseResponseStreamer} = require('./baseResponseStreamer');
const {fhirContentTypes} = require('./contentTypes');
const {BundleToCsvConverter} = require("../converters/bundleToCsvConverter");
const {BufferToChunkTransferResponse} = require("./buffer_to_chunk_transfer_response");
const { logError } = require('../operations/common/logging');

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
     * @return {Promise<void>}
     */
    async writeBundleEntryAsync({bundleEntry}) {
        this._bundle_entries.push(bundleEntry);
    }

    /**
     * sets the bundle to use
     * @param {Bundle} bundle
     */
    setBundle({bundle}) {
        this._bundle = bundle;
    }

    /**
     * ends response
     * @return {Promise<void>}
     */
    async endAsync() {
        try {
            if (this._bundle !== undefined && (this._bundle.entry || this._bundle_entries.length > 0)) {
                const filename = (this._bundle.id || String(this.requestId)) + '.zip';
                this.response.setHeader(
                    'Content-Disposition',
                    `attachment; filename="${filename}"`
                );
                this.response.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');

                if (this._bundle_entries.length > 0) {
                    this._bundle.entry = this._bundle_entries;
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
                        bundle: this._bundle
                    }
                );
                // Verify buffer before sending
                if (csvBuffer.length === 0) {
                    throw new Error('Generated zip buffer is empty');
                }

                await new BufferToChunkTransferResponse().sendLargeFileChunkedAsync(
                    {
                        response: this.response,
                        buffer: csvBuffer,
                        chunkSize: 64 * 1024
                    }
                );
            } else {
                this.response.status(404).end();
            }
        } catch (error) {
            logError('Error generating FHIR CSV export:', error);
            this.response.status(500).end();
        }

    }
}

module.exports = {
    FhirResponseCsvStreamer
};
