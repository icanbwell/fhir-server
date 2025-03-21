const { Transform } = require('stream');

class FhirResourceWriterBase extends Transform {
    /**
     * constructor
     * @param {boolean} objectMode
     * @param {string} contentType
     * @param {number} highWaterMark
     * @param {import('http').ServerResponse} response
     * @param {Boolean} rawResources
     * @param {Boolean} useFastSerializer
     */
    constructor (
        {
            objectMode,
            contentType,
            highWaterMark,
            response,
            rawResources,
            useFastSerializer
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

        /**
         * @type {Boolean}
         */
        this.useFastSerializer = useFastSerializer;
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
