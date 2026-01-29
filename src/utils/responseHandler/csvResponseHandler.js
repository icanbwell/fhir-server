const { BundleToCsvConverter } = require('../../converters/bundleToCsvConverter');
const { logError } = require('../../operations/common/logging');
const { BufferToChunkTransferResponse } = require('../buffer_to_chunk_transfer_response');
const { fhirContentTypes } = require('../contentTypes');
const { BaseResponseHandler } = require('./baseResponseHandler');

class CsvResponseHandler extends BaseResponseHandler {
    /**
     * sanitizes filename to be used in content-disposition header
     * @param {string} input
     * @return {string}
     */
    sanitizeFilename(input) {
        // Remove control characters and quotes that could break header
        // eslint-disable-next-line no-control-regex
        return String(input).replace(/[\r\n\x00-\x1f"]/g, '_');
    }

    /**
     * sends response
     * @param {Bundle} bundle
     * @param {string} cacheStatus
     * @return {Promise<void>}
     */
    async sendResponseAsync(bundle, cacheStatus) {
        try {
            if (bundle !== undefined && bundle.entry && bundle.entry.length > 0) {
                const rawFilename = bundle.id || String(this.requestId);
                const filename = this.sanitizeFilename(rawFilename) + '.zip';
                this.response.setHeader('Content-Type', fhirContentTypes.zip);
                this.response.setHeader('X-Request-ID', String(this.requestId));
                this.response.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
                this.response.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');

                /**
                 * @type {BundleToCsvConverter}
                 */
                const exporter = new BundleToCsvConverter();
                /**
                 * @type {Buffer}
                 */
                const csvBuffer = exporter.convert({
                    bundle
                });
                // Verify buffer before sending
                if (csvBuffer.length === 0) {
                    throw new Error('Generated zip buffer is empty');
                }

                await new BufferToChunkTransferResponse().sendLargeFileChunkedAsync({
                    response: this.response,
                    buffer: csvBuffer,
                    chunkSize: 64 * 1024
                });
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
    CsvResponseHandler
};
