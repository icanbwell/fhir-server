const {removeNull} = require('../../../utils/nullRemover');
const {assertIsValid, assertTypeEquals} = require('../../../utils/assertType');
const {getCircularReplacer} = require('../../../utils/getCircularReplacer');
const {FhirResourceWriterBase} = require('./fhirResourceWriterBase');
const {fhirContentTypes} = require('../../../utils/contentTypes');
const {getDefaultSortIdValue} = require('../../../utils/getDefaultSortIdValue');
const {ConfigManager} = require('../../../utils/configManager');
const {logInfo} = require('../../common/logging');

class FhirBundleWriter extends FhirResourceWriterBase {
    /**
     * Streams the incoming data inside a FHIR Bundle
     * @param {function (string | null, number): Bundle} fnBundle
     * @param {string | null} url
     * @param {AbortSignal} signal
     * @param {string} defaultSortId
     * @param {number} highWaterMark
     * @param {ConfigManager} configManager
     */
    constructor({fnBundle, url, signal, defaultSortId, highWaterMark, configManager}) {
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
    _transform(chunk, encoding, callback) {
        if (this._signal.aborted) {
            callback();
            return;
        }
        try {

            if (chunk !== null && chunk !== undefined) {
                const resourceJson = JSON.stringify(
                    {
                        resource: chunk.toJSON()
                    }, getCircularReplacer()
                );
                if (this.configManager.logStreamSteps) {
                    logInfo(`FhirBundleWriter _transform ${chunk['id']}`, {});
                }
                if (this._first) {
                    // write the beginning json
                    this._first = false;
                    this.push(resourceJson, encoding);
                } else {
                    // add comma at the beginning to make it legal json
                    this.push(',' + resourceJson, encoding);
                }
                // Depending on DEFAULT_SORT_ID, the last id can be either id or any other field.
                this._lastid = getDefaultSortIdValue(chunk, this.defaultSortId);
            }
        } catch (e) {
            this.emit('error', new AggregateError([e], 'FhirBundleWriter _transform: error'));
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
            const output = '],' + bundleJson.substring(1);
            if (this.configManager.logStreamSteps) {
                logInfo('FhirBundleWriter _flush', {output});
            }
            this.push(output); // skip the first "}"
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
        this.push(null);
        callback();
    }
}

module.exports = {
    FhirBundleWriter
};
