const { removeNull } = require('../../../utils/nullRemover');
const { assertIsValid, assertTypeEquals } = require('../../../utils/assertType');
const { getCircularReplacer } = require('../../../utils/getCircularReplacer');
const { FhirResourceWriterBase } = require('./fhirResourceWriterBase');
const { fhirContentTypes } = require('../../../utils/contentTypes');
const { ConfigManager } = require('../../../utils/configManager');
const { logInfo, logError } = require('../../common/logging');
const { RethrownError } = require('../../../utils/rethrownError');
const { convertErrorToOperationOutcome } = require('../../../utils/convertErrorToOperationOutcome');
const { captureException } = require('../../common/sentry');
const { removeUnderscoreProps } = require('../../../utils/removeUnderscoreProps');

class FhirBundleWriter extends FhirResourceWriterBase {
    /**
     * Streams the incoming data inside a FHIR Bundle
     * @param {function (string | null, number): Bundle} fnBundle
     * @param {string | null} url
     * @param {AbortSignal} signal
     * @param {string} defaultSortId
     * @param {number} highWaterMark
     * @param {ConfigManager} configManager
     * @param {import('http').ServerResponse} response
     * @param {Boolean} rawResources
     */
    constructor ({ fnBundle, url, signal, defaultSortId, highWaterMark, configManager, response, rawResources = false }) {
        super({ objectMode: true, contentType: fhirContentTypes.fhirJson, highWaterMark, response, rawResources });
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
    _transform (chunk, encoding, callback) {
        if (this._signal.aborted) {
            callback();
            return;
        }
        const chunkId = chunk.id;
        let chunkJson = {};
        try {
            if (chunk !== null && chunk !== undefined) {
                // Depending on DEFAULT_SORT_ID, the last id can be either id or any other field.
                this._lastid = chunk[this.defaultSortId];

                if (this.rawResources){
                    chunkJson = chunk;
                    removeUnderscoreProps(chunkJson);
                }
                else {
                    chunkJson = chunk.toJSON();
                }
                const resourceJson = JSON.stringify(
                    {
                        resource: chunkJson
                    }, getCircularReplacer()
                );
                if (this.configManager.logStreamSteps) {
                    logInfo(`FhirBundleWriter _transform ${chunk.id}`, {});
                }
                if (this._first) {
                    // write the beginning json
                    this._first = false;
                    this.push('{"entry":[' + resourceJson, encoding);
                } else {
                    // add comma at the beginning to make it legal json
                    this.push(',' + resourceJson, encoding);
                }
            }
            callback();
        } catch (e) {
            // don't let error past this since we're streaming so we can't send errors to http client
            const error = new RethrownError(
                {
                    message: `FhirBundleWriter _transform: error: ${e.message}: id: ${chunkId}`,
                    error: e,
                    args: {
                        chunkId,
                        chunkJson,
                        encoding
                    }
                }
            );
            logError(`FhirBundleWriter _transform: error: ${e.message}: id: ${chunkId}`, {
                error: e,
                source: 'FhirBundleWriter._transform',
                args: {
                    stack: e.stack,
                    message: e.message,
                    chunkId,
                    encoding
                }
            });
            // as we are not propagating this error, send this to sentry
            captureException(error);

            this.writeErrorAsOperationOutcome({ error: { ...error, message: `Error occurred while streaming response for chunk: ${chunkId}` } });
            callback();
        }
    }

    /**
     * writes an error as an OperationOutcome
     * @param {Error} error
     * @param {import('stream').BufferEncoding} encoding
     */
    writeErrorAsOperationOutcome ({ error }) {
        /**
         * @type {OperationOutcome}
         */
        const operationOutcome = convertErrorToOperationOutcome({
            error
        });
        const operationOutcomeJson = JSON.stringify(operationOutcome.toJSON());
        if (this._first) {
            // write the beginning json
            this._first = false;
            // this is an unexpected error so set statuscode 500
            this.response.statusCode = 500;
            this.push('{"entry":[' + operationOutcomeJson);
        } else {
            // add comma at the beginning to make it legal json
            this.push(',' + operationOutcomeJson);
        }
    }

    /**
     * @param {import('stream').TransformCallBack} callback
     * @private
     */
    _flush (callback) {
        try {
            /**
             * @type {number}
             */
            const stopTime = Date.now();

            /**
             * @type {Bundle}
             */
            let bundle = this._fnBundle(this._lastid, stopTime);

            if (this.rawResources){
                removeUnderscoreProps(bundle);
            }
            else {
                bundle = bundle.toJSON();
            }
            /**
             * @type {Object}
             */
            const cleanObject = removeNull(bundle);
            /**
             * @type {string}
             */
            const bundleJson = JSON.stringify(cleanObject);

            // write ending json
            const output = '],' + bundleJson.substring(1);
            if (this.configManager.logStreamSteps) {
                logInfo('FhirBundleWriter _flush', { output });
            }
            if (this._first) {
                this._first = false;
                this.push('{"entry":[');
            }
            this.push(output); // skip the first "}"
        } catch (e) {
            // don't let error past this since we're streaming so we can't send errors to http client
            const error = new RethrownError(
                {
                    message: `FhirBundleWriter _flush: error: ${e.message}`,
                    error: e,
                    args: {}
                }
            );
            logError(`FhirBundleWriter _flush: error: ${e.message}`, {
                error: e,
                source: 'FhirBundleWriter._flush',
                args: {
                    stack: e.stack,
                    message: e.message
                }
            });
            // as we are not propagating this error, send this to sentry
            captureException(error);
            this.writeErrorAsOperationOutcome({ error: { ...error, message: 'Error occurred while streaming response' } });
            this.push(']}');
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
    FhirBundleWriter
};
