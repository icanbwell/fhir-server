const {convertErrorToOperationOutcome} = require('../../../utils/convertErrorToOperationOutcome');
const {getCircularReplacer} = require('../../../utils/getCircularReplacer');
const {FhirResourceWriterBase} = require('./fhirResourceWriterBase');

class FhirResourceWriter extends FhirResourceWriterBase {
    /**
     * Streams the incoming data as json
     * @param {AbortSignal} signal
     * @param {string} contentType
     * @param {number} highWaterMark
     */
    constructor({signal, contentType, highWaterMark}) {
        super({objectMode: true, contentType: contentType, highWaterMark: highWaterMark});
        /**
         * @type {boolean}
         * @private
         */
        this._first = true;
        this.push('[');
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
                const resourceJson = JSON.stringify(chunk.toJSON(), getCircularReplacer());
                if (this._first) {
                    // write the beginning json
                    this._first = false;
                    this.push(resourceJson, encoding);
                } else {
                    // add comma at the beginning to make it legal json
                    this.push(',' + resourceJson, encoding);
                }
            }
        } catch (e) {
            // don't let error past this since we're streaming so we can't send errors to http client
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
        if (this._signal.aborted) {
            callback();
            return;
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
    writeOperationOutcome({operationOutcome, encoding}) {
        const operationOutcomeJson = JSON.stringify(operationOutcome.toJSON());
        if (this._first) {
            // write the beginning json
            this._first = false;
            this.push(operationOutcomeJson, encoding);
        } else {
            // add comma at the beginning to make it legal json
            this.push(',' + operationOutcomeJson, encoding);
        }
    }
}

module.exports = {
    FhirResourceWriter
};
