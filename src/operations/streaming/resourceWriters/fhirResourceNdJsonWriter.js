const {isTrue} = require('../../../utils/isTrue');
const env = require('var');
const {convertErrorToOperationOutcome} = require('../../../utils/convertErrorToOperationOutcome');
const {logInfo} = require('../../common/logging');
const {FhirResourceWriterBase} = require('./fhirResourceWriterBase');

class FhirResourceNdJsonWriter extends FhirResourceWriterBase {
    /**
     * Streams the incoming data as json
     *
     * @param {AbortSignal} signal
     * @param {string} contentType
     * @param {number} highWaterMark
     */
    constructor({signal, contentType, highWaterMark}) {
        super({objectMode: true, contentType: contentType, highWaterMark: highWaterMark});

        /**
         * @type {AbortSignal}
         * @private
         */
        this._signal = signal;
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
                if (isTrue(env.LOG_STREAM_STEPS)) {
                    logInfo(`FhirResourceNdJsonWriter: _transform ${chunk['id']}`, {});
                }
                const resourceJson = chunk.toJSON();
                this.push(resourceJson + '\n', encoding);
            }
        } catch (e) {
            const operationOutcome = convertErrorToOperationOutcome({error: e});
            this.writeOperationOutcome({operationOutcome, encoding});
        }
        callback();
    }

    /**
     * @param {import('stream').TransformCallBack} callback
     * @private
     */
    _flush(callback) {
        if (isTrue(env.LOG_STREAM_STEPS)) {
            logInfo('FhirResourceNdJsonWriter: _flush', {});
        }
        callback();
    }

    /**
     * writes an OperationOutcome
     * @param {OperationOutcome} operationOutcome
     * @param {import('stream').BufferEncoding|null} [encoding]
     */
    writeOperationOutcome({operationOutcome, encoding}) {
        const operationOutcomeJson = JSON.stringify(operationOutcome.toJSON());
        this.push(operationOutcomeJson + '\n', encoding);
    }

    getContentType() {
        return this._contentType;
    }
}

module.exports = {
    FhirResourceNdJsonWriter
};
