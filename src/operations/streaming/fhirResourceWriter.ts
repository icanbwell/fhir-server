const {Transform} = require('stream');

class FhirResourceWriter extends Transform {
    /**
     * Streams the incoming data as json
     * @param {AbortSignal} signal
     */
    constructor({signal}) {
        super({objectMode: true});
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
     * @param {Object} chunk
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
                const resourceJson = JSON.stringify(chunk);
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
            const operationOutcome = {
                resourceType: 'OperationOutcome',
                issue: [
                    {
                        severity: 'error',
                        code: 'exception',
                        details: {
                            text: 'Error streaming bundle'
                        },
                        diagnostics: e.toString()
                    }
                ]
            };
            if (this._first) {
                // write the beginning json
                this._first = false;
                this.push(operationOutcome, encoding);
            } else {
                // add comma at the beginning to make it legal json
                this.push(',' + operationOutcome, encoding);
            }
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
        callback();
    }
}

module.exports = {
    FhirResourceWriter
};
