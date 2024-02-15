const { Transform } = require('stream');

class FhirResourceWriterBase extends Transform {
    /**
     * constructor
     * @param {boolean} objectMode
     * @param {string} contentType
     * @param {number} highWaterMark
     * @param {import('http').ServerResponse} response
     */
    constructor (
        {
            objectMode,
            contentType,
            highWaterMark,
            response
        }
    ) {
        super({ objectMode: objectMode, highWaterMark: highWaterMark });

        /**
         * @type {string}
         */
        this._contentType = contentType;

        /**
         * @type {import('http').ServerResponse}
         */
        this.response = response;
    }

    /**
     * @returns {string}
     */
    getContentType () {
        return this._contentType;
    }
}

module.exports = {
    FhirResourceWriterBase
};
