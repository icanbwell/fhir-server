const { Transform } = require('@json2csv/node');
const { flatten } = require('@json2csv/transforms');
const { assertTypeEquals } = require('../../../utils/assertType');
const { ConfigManager } = require('../../../utils/configManager');
const { logInfo } = require('../../common/logging');
const { FhirResourceSerializer } = require('../../../fhir/fhirResourceSerializer');

class FhirResourceCsvWriter extends Transform {
    /**
     * Streams the incoming data as json
     *
     * @param {AbortSignal} signal
     * @param {string} delimiter
     * @param {string} contentType
     * @param {number} highWaterMark
     * @param {ConfigManager} configManager
     */
    constructor({
        signal,
        delimiter,
        contentType,
        highWaterMark,
        configManager
    }) {
        /**
         * @type {import('@json2csv/node').Json2CSVBaseOptions}
         */
        const opts = {
            delimiter,
            transforms: [
                flatten({ objects: true, arrays: true, separator: '.' })
            ]
        };
        /**
         * @type {import('@json2csv/node').StreamParserOptions}
         */
        const asyncOpts = {};

        /**
         * @type {TransformOptions}
         */
        const transformOpts = {
            objectMode: true,
            highWaterMark
        };
        super(opts, asyncOpts, transformOpts);

        /**
         * @type {AbortSignal}
         * @private
         */
        this._signal = signal;

        /**
         * @type {string}
         * @private
         */
        this._contentType = contentType;

        /**
         * @type {ConfigManager}
         */
        this.configManager = configManager;
        assertTypeEquals(configManager, ConfigManager);
    }

    /**
     * transform
     * @param {Resource} chunk
     * @param encoding
     * @param done
     * @private
     */
    _transform (
        chunk,
        encoding,
        done
    ) {
        if (this.configManager.logStreamSteps) {
            logInfo(`FhirResourceCsvWriter._transform${chunk.id}`, {});
        }
        FhirResourceSerializer.serialize(chunk);
        return super._transform(chunk, encoding, done);
    }

    /**
     * writes an OperationOutcome
     * @param {OperationOutcome} operationOutcome
     * @param {import('stream').BufferEncoding|null} [encoding]
     */

    writeOperationOutcome ({ operationOutcome, encoding }) {
    }

    getContentType () {
        return this._contentType;
    }
}

module.exports = {
    FhirResourceCsvWriter
};
