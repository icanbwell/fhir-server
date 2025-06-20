const {convertErrorToOperationOutcome} = require('../../../utils/convertErrorToOperationOutcome');
const {logInfo, logError} = require('../../common/logging');
const {FhirResourceWriterBase} = require('./fhirResourceWriterBase');
const {assertTypeEquals} = require('../../../utils/assertType');
const {ConfigManager} = require('../../../utils/configManager');
const {captureException} = require('../../common/sentry');
const {FhirResourceSerializer} = require('../../../fhir/fhirResourceSerializer');
const {BundleToExcelConverter} = require("../../../converters/bundleToExcelConverter");
const {generateUUID} = require("../../../utils/uid.util");
const {BufferToChunkTransferResponse} = require("../../../utils/buffer_to_chunk_transfer_response");

class FhirResourceExcelWriter extends FhirResourceWriterBase {
    /**
     * Streams the incoming data as json
     *
     * @param {AbortSignal} signal
     * @param {string} contentType
     * @param {number} highWaterMark
     * @param {ConfigManager} configManager
     * @param {import('http').ServerResponse} response
     */
    constructor({
                    signal,
                    contentType,
                    highWaterMark,
                    configManager,
                    response
                }) {
        super({objectMode: true, contentType, highWaterMark, response});
        /**
         * @type {AbortSignal}
         * @private
         */
        this._signal = signal;

        /**
         * @type {ConfigManager}
         */
        this.configManager = configManager;
        assertTypeEquals(configManager, ConfigManager);

        /**
         *  list of json resources
         * @type {Object[]}
         */
        this.json_resources = [];

        /**
         * @type {string}
         */
        this.requestId = this.response.req.id;
    }

    /**
     * transforms a chunk
     * @param {Resource} chunk
     * @param {import('stream').BufferEncoding} encoding
     * @param {import('stream').TransformCallBack} callback
     * @private
     */
    _transform(chunk, encoding, callback) {
        if (this._signal.aborted) {
            callback();
            return;
        }
        try {
            if (chunk !== null && chunk !== undefined) {
                if (this.configManager.logStreamSteps) {
                    logInfo(`FhirResourceExcelWriter: _transform ${chunk.id}`, {});
                }
                FhirResourceSerializer.serialize(chunk);
                this.json_resources.push(chunk);
            }
        } catch (e) {
            logError(`FhirResourceExcelWriter _transform: error: ${e.message}`, {
                error: e,
                source: 'FhirResourceExcelWriter._transform',
                args: {
                    stack: e.stack,
                    message: e.message
                }
            });
            // as we are not propagating this error, send this to sentry
            captureException(e);
            const operationOutcome = convertErrorToOperationOutcome({
                error: {
                    ...e,
                    message: `Error occurred while streaming response for chunk: ${chunk?.id}`
                }
            });
            this.writeOperationOutcome({operationOutcome, encoding});
        }
        callback();
    }

    /**
     * @param {import('stream').TransformCallBack} callback
     * @private
     */
    _flush(callback) {
        if (this.configManager.logStreamSteps) {
            logInfo('FhirResourceExcelWriter: _flush', {});
        }

        if (this.json_resources.length > 0) {
            // now convert to Excel and write it out
            this.response.setHeader('Content-Type', this.getContentType());
            this.response.setHeader('X-Request-ID', String(this.requestId));

            const filename = (this.requestId ? String(this.requestId) : generateUUID()) + '.xlsx';
            this.response.setHeader(
                'Content-Disposition',
                `attachment; filename="${filename}"`
            );
            this.response.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');

            /**
             * @type {BundleToExcelConverter}
             */
            const exporter = new BundleToExcelConverter();
            /**
             * @type {Buffer}
             */
            const excelBuffer = exporter.convertResources(
                {
                    resources: this.json_resources
                }
            );
            // write the buffer to the response
            new BufferToChunkTransferResponse().sendLargeFileChunkedAsync(
                {
                    response: this.response,
                    buffer: excelBuffer,
                    chunkSize: 64 * 1024
                }
            ).then(
                () => callback()
            );
        } else {
            // if no resources were written, we still need to end the stream
            this.response.setHeader('Content-Type', this.getContentType());
            this.response.setHeader('X-Request-ID', String(this.requestId));
            this.response.statusCode = 204; // No Content
            callback();
        }
    }

    /**
     * writes an OperationOutcome
     * @param {OperationOutcome} operationOutcome
     * @param {import('stream').BufferEncoding|null} [encoding]
     */
    writeOperationOutcome({operationOutcome, encoding}) {
        // this is an unexpected error so set statuscode 500
        this.response.statusCode = 500;
        const operationOutcomeJson = JSON.stringify(operationOutcome.toJSON());
        this.push(operationOutcomeJson + '\n', encoding);
    }

    getContentType() {
        return this._contentType;
    }
}

module.exports = {
    FhirResourceExcelWriter
};
