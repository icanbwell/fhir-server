const {Transform} = require('@json2csv/node');
const {flatten} = require('@json2csv/transforms');

class FhirResourceCsvWriter extends Transform {
    /**
     * Streams the incoming data as json
     *
     * @param {AbortSignal} signal
     * @param {string} delimiter
     * @param {string} contentType
     * @param {number} highWaterMark
     */
    constructor({signal, delimiter, contentType, highWaterMark}) {
        /**
         * @type {import('@json2csv/node').Json2CSVBaseOptions}
         */
        const opts = {
            delimiter: delimiter,
            transforms: [
                flatten({objects: true, arrays: true, separator: '.'}),
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
            highWaterMark: highWaterMark
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
        this._delimiter = delimiter;

        /**
         * @type {string}
         * @private
         */
        this._contentType = contentType;
    }

    /**
     * transform
     * @param {Resource} chunk
     * @param encoding
     * @param done
     * @private
     */
    _transform(
        chunk,
        encoding,
        done
    ) {
        return super._transform(chunk.toJSON(), encoding, done);
    }

    /**
     * writes an OperationOutcome
     * @param {OperationOutcome} operationOutcome
     * @param {import('stream').BufferEncoding|null} [encoding]
     */
    // eslint-disable-next-line no-unused-vars
    writeOperationOutcome({operationOutcome, encoding}) {
    }

    getContentType() {
        return this._contentType;
    }
}

module.exports = {
    FhirResourceCsvWriter
};
