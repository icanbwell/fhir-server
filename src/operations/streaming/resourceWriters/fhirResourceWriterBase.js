const {Transform} = require('stream');

class FhirResourceWriterBase extends Transform {
    /**
     * constructor
     * @param {boolean} objectMode
     * @param {string} contentType
     * @param {number} highWaterMark
     */
    constructor(
        {
            objectMode,
            contentType,
            highWaterMark
        }
    ) {
        super({objectMode: objectMode, highWaterMark: highWaterMark});

        /**
         * @type {string}
         */
        this._contentType = contentType;
    }

    /**
     * @returns {string}
     */
    getContentType() {
        return this._contentType;
    }
}

module.exports = {
    FhirResourceWriterBase
};
