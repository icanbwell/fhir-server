const { Transform } = require('stream');

class FhirResourceWriterBase extends Transform {
    /**
     * constructor
     * @param {boolean} objectMode
     * @param {string} contentType
     * @param {number} highWaterMark
     * @param {import('http').ServerResponse} response
     * @param {Boolean} rawResources
     */
    constructor (
        {
            objectMode,
            contentType,
            highWaterMark,
            response,
            rawResources
        }
    ) {
        super({ objectMode, highWaterMark });

        /**
         * @type {string}
         */
        this._contentType = contentType;

        /**
         * @type {import('http').ServerResponse}
         */
        this.response = response;

        /**
         * @type {Boolean}
         */
        this.rawResources = rawResources;
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
