const {Transform} = require('@json2csv/node');
const {flatten} = require('@json2csv/transforms');

class FhirResourceCsvWriter extends Transform {
    /**
     * Streams the incoming data as json
     *
     * @param {AbortSignal} signal
     * @param {string} delimiter
     * @param {string} contentType
     */
    constructor({signal, delimiter, contentType}) {
        const opts = {
            delimiter: delimiter,
            transforms: [
                // unwind(),
                flatten({objects: true, arrays: true, separator: '.'}),
            ]
        };
        const transformOpts = {
            objectMode: true
        };
        const asyncOpts = {
            objectMode: true
        };

        super(opts, transformOpts, asyncOpts);

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

    // _transform(chunk, encoding, done) {
    //     super._transform(chunk, encoding, done);
    // }

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
