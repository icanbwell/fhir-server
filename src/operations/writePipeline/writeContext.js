const { FhirRequestInfo } = require('../../utils/fhirRequestInfo');

/**
 * The frozen, request-wide values passed to every step: the request info, the base version, the
 * parsed args, and whether the write is a smart merge.
 */
class WriteContext {
    /**
     * @param {FhirRequestInfo} requestInfo
     * @param {string} base_version
     * @param {Object} parsedArgs
     * @param {boolean} smartMerge
     */
    constructor ({ requestInfo, base_version, parsedArgs, smartMerge }) {
        /**
         * @type {FhirRequestInfo}
         */
        this.requestInfo = requestInfo;
        /**
         * @type {string}
         */
        this.base_version = base_version;
        /**
         * @type {Object}
         */
        this.parsedArgs = parsedArgs;
        /**
         * @type {boolean}
         */
        this.smartMerge = smartMerge;
        Object.freeze(this);
    }
}

module.exports = {
    WriteContext
};
