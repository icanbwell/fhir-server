class BaseValidator {
    /**
     * @param {FhirRequestInfo} requestInfo
     * @param {string} currentOperationName
     * @param {Object|Object[]} incomingResources
     * @param {string} base_version
     * @returns {Promise<{preCheckErrors: MergeResultEntry[], validatedObjects: Object[], wasAList: boolean}>}
     */

    async validate ({ requestInfo, currentOperationName, incomingResources, base_version }) {
        throw Error('Not implemented');
    }
}

module.exports = {
    BaseValidator
};
