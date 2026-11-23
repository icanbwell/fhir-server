const { FhirRequestInfo } = require('../../utils/fhirRequestInfo');

/**
 * The frozen, request-wide values passed to every step: the request info, the base version, the
 * parsed args, whether the write is a smart merge, and the operation name.
 */
class WriteContext {
    /**
     * @param {FhirRequestInfo} requestInfo
     * @param {string} base_version
     * @param {Object} parsedArgs
     * @param {boolean} smartMerge
     * @param {string} operationName
     */
    constructor ({ requestInfo, base_version, parsedArgs, smartMerge, operationName }) {
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
        /**
         * @type {string}
         */
        this.operationName = operationName;
        Object.freeze(this);
    }
}

module.exports = {
    WriteContext
};
