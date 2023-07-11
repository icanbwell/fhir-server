const {Transform} = require('stream');

class FhirResourceWriterBase extends Transform {
    /**
     * constructor
     * @param {boolean} objectMode
     * @param {string} contentType
     */
    constructor({
        objectMode,
        contentType
                }) {
        super({objectMode: objectMode});

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
