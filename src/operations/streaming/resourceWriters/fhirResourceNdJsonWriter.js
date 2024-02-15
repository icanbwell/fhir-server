const { convertErrorToOperationOutcome } = require('../../../utils/convertErrorToOperationOutcome');
const { logInfo, logError } = require('../../common/logging');
const { FhirResourceWriterBase } = require('./fhirResourceWriterBase');
const { getCircularReplacer } = require('../../../utils/getCircularReplacer');
const { assertTypeEquals } = require('../../../utils/assertType');
const { ConfigManager } = require('../../../utils/configManager');
const { captureException } = require('../../common/sentry');

class FhirResourceNdJsonWriter extends FhirResourceWriterBase {
    /**
     * Streams the incoming data as json
     *
     * @param {AbortSignal} signal
     * @param {string} contentType
     * @param {number} highWaterMark
     * @param {ConfigManager} configManager
     * @param {import('http').ServerResponse} response
     */
    constructor ({ signal, contentType, highWaterMark, configManager, response }) {
        super({ objectMode: true, contentType, highWaterMark, response });
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
    }

    /**
     * transforms a chunk
     * @param {Resource} chunk
     * @param {import('stream').BufferEncoding} encoding
     * @param {import('stream').TransformCallBack} callback
     * @private
     */
    _transform (chunk, encoding, callback) {
        if (this._signal.aborted) {
            callback();
            return;
        }
        try {
            if (chunk !== null && chunk !== undefined) {
                if (this.configManager.logStreamSteps) {
                    logInfo(`FhirResourceNdJsonWriter: _transform ${chunk.id}`, {});
                }
                const resourceJson = JSON.stringify(chunk.toJSON(), getCircularReplacer());
                this.push(resourceJson + '\n', encoding);
            }
        } catch (e) {
            logError(`FhirResourceNdJsonWriter _transform: error: ${e.message}`, {
                error: e,
                source: 'FhirResourceNdJsonWriter._transform',
                args: {
                    stack: e.stack,
                    message: e.message
                }
            });
            // as we are not propagating this error, send this to sentry
            captureException(e);
            const operationOutcome = convertErrorToOperationOutcome({ error: { ...e, message: `Error occurred while streaming response for chunk: ${chunk?.id}` } });
            this.writeOperationOutcome({ operationOutcome, encoding });
        }
        callback();
    }

    /**
     * @param {import('stream').TransformCallBack} callback
     * @private
     */
    _flush (callback) {
        if (this.configManager.logStreamSteps) {
            logInfo('FhirResourceNdJsonWriter: _flush', {});
        }
        this.push(null);
        callback();
    }

    /**
     * writes an OperationOutcome
     * @param {OperationOutcome} operationOutcome
     * @param {import('stream').BufferEncoding|null} [encoding]
     */
    writeOperationOutcome ({ operationOutcome, encoding }) {
        // this is an unexpected error so set statuscode 500
        this.response.statusCode = 500;
        const operationOutcomeJson = JSON.stringify(operationOutcome.toJSON());
        this.push(operationOutcomeJson + '\n', encoding);
    }

    getContentType () {
        return this._contentType;
    }
}

module.exports = {
    FhirResourceNdJsonWriter
};
