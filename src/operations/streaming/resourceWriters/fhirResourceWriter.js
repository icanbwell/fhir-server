const {convertErrorToOperationOutcome} = require('../../../utils/convertErrorToOperationOutcome');
const {getCircularReplacer} = require('../../../utils/getCircularReplacer');
const {FhirResourceWriterBase} = require('./fhirResourceWriterBase');
const {assertTypeEquals} = require('../../../utils/assertType');
const {ConfigManager} = require('../../../utils/configManager');
const {logInfo, logError} = require('../../common/logging');
const { captureException } = require('../../common/sentry');

class FhirResourceWriter extends FhirResourceWriterBase {
    /**
     * Streams the incoming data as json
     * @param {AbortSignal} signal
     * @param {string} contentType
     * @param {number} highWaterMark
     * @param {ConfigManager} configManager
     * @param {import('http').ServerResponse} response
     */
    constructor ({signal, contentType, highWaterMark, configManager, response}) {
        super({objectMode: true, contentType: contentType, highWaterMark: highWaterMark, response});
        /**
         * @type {boolean}
         * @private
         */
        this._first = true;
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
                const resourceJson = JSON.stringify(chunk.toJSON(), getCircularReplacer());
                if (this.configManager.logStreamSteps) {
                    logInfo(`FhirResourceWriter _transform ${chunk['id']}`, {});
                }
                if (this._first) {
                    // write the beginning json
                    this._first = false;
                    this.push('[' + resourceJson, encoding);
                } else {
                    // add comma at the beginning to make it legal json
                    this.push(',' + resourceJson, encoding);
                }
            }
        } catch (e) {
            logError(`FhirResourceWriter _transform: error: ${e.message}`, {
                error: e,
                source: 'FhirResourceWriter._transform',
                args: {
                    stack: e.stack,
                    message: e.message,
                    encoding
                }
            });
            // as we are not propagating this error, send this to sentry
            captureException(e);
            // don't let error past this since we're streaming so we can't send errors to http client
            const operationOutcome = convertErrorToOperationOutcome({error: {...e, message: `Error occurred while streaming response for chunk: ${chunk?.id}`}});
            this.writeOperationOutcome({operationOutcome, encoding});
        }
        callback();
    }

    /**
     * @param {import('stream').TransformCallBack} callback
     * @private
     */
    _flush (callback) {
        if (this._signal.aborted) {
            callback();
            return;
        }
        if (this.configManager.logStreamSteps) {
            logInfo('FhirResourceWriter _flush', {});
        }
        if (this._first) {
            this._first = false;
            this.push('[');
        }
        // write ending json
        this.push(']');
        this.push(null);
        callback();
    }

    /**
     * writes an OperationOutcome
     * @param {OperationOutcome} operationOutcome
     * @param {import('stream').BufferEncoding|null} [encoding]
     */
    writeOperationOutcome ({operationOutcome, encoding}) {
        const operationOutcomeJson = JSON.stringify(operationOutcome.toJSON());
        if (this._first) {
            // write the beginning json
            this._first = false;
            // this is an unexpected error so set statuscode 500
            this.response.statusCode = 500;
            this.push('[' + operationOutcomeJson, encoding);
        } else {
            // add comma at the beginning to make it legal json
            this.push(',' + operationOutcomeJson, encoding);
        }
    }
}

module.exports = {
    FhirResourceWriter
};
