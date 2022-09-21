const {Transform} = require('stream');
const {removeNull} = require('../../utils/nullRemover');
const {assertIsValid} = require('../../utils/assertType');

class FhirBundleWriter extends Transform {
    /**
     * Streams the incoming data inside a FHIR Bundle
     * @param {function (string | null, number): Bundle} fnBundle
     * @param {string | null} url
     * @param {AbortSignal} signal
     */
    constructor({fnBundle, url, signal}) {
        super({objectMode: true});
        /**
         * @type {function (string | null, number): Bundle}
         * @private
         */
        this._fnBundle = fnBundle;
        assertIsValid(fnBundle);
        /**
         * @type {string|null}
         * @private
         */
        /**
         * @type {string|null}
         * @private
         */
        this._url = url;
        /**
         * @type {boolean}
         * @private
         */
        this._first = true;
        this.push('{"entry":[');
        /**
         * @type {string | null}
         * @private
         */
        this._lastid = null;
        /**
         * @type {AbortSignal}
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
                const resourceJson = JSON.stringify(
                    {
                        resource: chunk
                    }
                );
                if (this._first) {
                    // write the beginning json
                    this._first = false;
                    this.push(resourceJson, encoding);
                } else {
                    // add comma at the beginning to make it legal json
                    this.push(',' + resourceJson, encoding);
                }
                this._lastid = chunk['id'];
            }
        } catch (e) {
            throw new AggregateError([e], 'FhirBundleWriter _transform: error');
        }
        callback();
    }

    /**
     * @param {import('stream').TransformCallBack} callback
     * @private
     */
    _flush(callback) {
        try {
            /**
             * @type {number}
             */
            const stopTime = Date.now();

            /**
             * @type {Bundle}
             */
            const bundle = this._fnBundle(this._lastid, stopTime);

            // noinspection JSUnresolvedFunction
            /**
             * @type {Object}
             */
            const cleanObject = removeNull(bundle.toJSON());
            /**
             * @type {string}
             */
            const bundleJson = JSON.stringify(cleanObject);

            // write ending json
            this.push('],' + bundleJson.substring(1)); // skip the first "}"
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
            const operationOutcomeJson = JSON.stringify({resource: operationOutcome});
            if (this._first) {
                // write the beginning json
                this._first = false;
                this.push(operationOutcomeJson);
            } else {
                // add comma at the beginning to make it legal json
                this.push(',' + operationOutcomeJson);
            }
            this.push(']}');
        }
        callback();
    }
}

module.exports = {
    FhirBundleWriter
};
