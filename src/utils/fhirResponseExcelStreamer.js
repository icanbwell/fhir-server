const {BaseResponseStreamer} = require('./baseResponseStreamer');
const {fhirContentTypes} = require('./contentTypes');
const {BundleToExcelConverter} = require("../converters/bundleToExcelConverter");
const {BufferToChunkTransferResponse} = require("./buffer_to_chunk_transfer_response");

class FhirResponseExcelStreamer extends BaseResponseStreamer {
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
        const contentType = fhirContentTypes.excel;
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
            if (this._bundle !== undefined && this._bundle_entries.length > 0) {
                const filename = (this._bundle.id || String(this.requestId)) + '.xlsx';
                this.response.setHeader(
                    'Content-Disposition',
                    `attachment; filename="${filename}"`
                );
                this.response.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');

                this._bundle.entry = this._bundle_entries;

                /**
                 * @type {BundleToExcelConverter}
                 */
                const exporter = new BundleToExcelConverter();
                /**
                 * @type {Buffer}
                 */
                const excelBuffer = exporter.convert(
                    {
                        bundle: this._bundle
                    }
                );

                // Verify buffer before sending
                if (excelBuffer.length === 0) {
                    throw new Error('Generated Excel buffer is empty');
                }

                await new BufferToChunkTransferResponse().sendLargeFileChunkedAsync(
                    {
                        response: this.response,
                        buffer: excelBuffer,
                        chunkSize: 64 * 1024
                    }
                );
            } else {
                this.response.status(404).end();
            }
        } catch (error) {
            console.error('Error generating FHIR Excel export:', error);
            this.response.status(500).end();
        }

    }
}

module.exports = {
    FhirResponseExcelStreamer
};
