class BaseValidator {
    /**
     * @param {FhirRequestInfo} requestInfo
     * @param {string} currentOperationName
     * @param {Resource|Resource[]} incomingResources
     * @param {string} base_version
     * @returns {Promise<{preCheckErrors: MergeResultEntry[], validatedObjects: Resource[], wasAList: boolean}>}
     */

    async validate ({ requestInfo, currentOperationName, incomingResources, base_version }) {
        throw Error('Not implemented');
    }
}

module.exports = {
    BaseValidator
};
