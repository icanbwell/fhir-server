const {removeNull} = require('../../../utils/nullRemover');
const {assertIsValid} = require('../../../utils/assertType');
const {getCircularReplacer} = require('../../../utils/getCircularReplacer');
const {FhirResourceWriterBase} = require('./fhirResourceWriterBase');
const {fhirContentTypes} = require('../../../utils/contentTypes');

class FhirBundleWriter extends FhirResourceWriterBase {
    /**
     * Streams the incoming data inside a FHIR Bundle
     * @param {function (string | null, number): Bundle} fnBundle
     * @param {string | null} url
     * @param {AbortSignal} signal
     * @param {string} defaultSortId
     * @param {number} highWaterMark
     */
    constructor({fnBundle, url, signal, defaultSortId, highWaterMark}) {
        super({objectMode: true, contentType: fhirContentTypes.fhirJson, highWaterMark: highWaterMark});
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
        /**
         * @type {string}
         */
        this.defaultSortId = defaultSortId;
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
                    }, getCircularReplacer()
                );
                if (this._first) {
                    // write the beginning json
                    this._first = false;
                    this.push(resourceJson, encoding);
                } else {
                    // add comma at the beginning to make it legal json
                    this.push(',' + resourceJson, encoding);
                }
                // Depending on DEFAULT_SORT_ID, the last id can be either id or any other field.
                this._lastid = chunk[this.defaultSortId];

                if (!this._lastid && chunk.identifier) {
                    chunk.identifier.forEach(identifier => {
                        if (identifier.system.split('/').pop() === this.defaultSortId.replace('_', '')) {
                            this._lastid = identifier.value;
                        }
                    });
                }
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
            const operationOutcomeJson = JSON.stringify({resource: operationOutcome}, getCircularReplacer());
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
