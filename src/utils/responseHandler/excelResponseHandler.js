const { BundleToExcelConverter } = require('../../converters/bundleToExcelConverter');
const { logError } = require('../../operations/common/logging');
const { BufferToChunkTransferResponse } = require('../buffer_to_chunk_transfer_response');
const { fhirContentTypes } = require('../contentTypes');
const { BaseResponseHandler } = require('./baseResponseHandler');

class ExcelResponseHandler extends BaseResponseHandler {
    /**
     * sends response
     * @param {Bundle} bundle
     * @param {string} cacheStatus
     * @return {Promise<void>}
     */
    async sendResponseAsync(bundle, cacheStatus) {
        try {
            if (bundle && Array.isArray(bundle.entry) && bundle.entry.length > 0) {
                const filename = (bundle.id || String(this.requestId)) + '.xlsx';
                this.response.setHeader('Content-Type', fhirContentTypes.excel);
                this.response.setHeader('X-Request-ID', String(this.requestId));
                this.response.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
                this.response.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');

                /**
                 * @type {BundleToExcelConverter}
                 */
                const exporter = new BundleToExcelConverter();
                /**
                 * @type {Buffer}
                 */
                const excelBuffer = exporter.convert({
                    bundle
                });

                // Verify buffer before sending
                if (excelBuffer.length === 0) {
                    throw new Error('Generated Excel buffer is empty');
                }

                await new BufferToChunkTransferResponse().sendLargeFileChunkedAsync({
                    response: this.response,
                    buffer: excelBuffer,
                    chunkSize: 64 * 1024
                });
            } else {
                this.response.status(404).end();
            }
        } catch (error) {
            logError('Error generating FHIR Excel export:', error);
            this.response.status(500).end();
        }
    }
}

module.exports = {
    ExcelResponseHandler
};
