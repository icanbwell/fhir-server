class BaseValidator {
    /**
     * @param {FhirRequestInfo} requestInfo
     * @param {date} currentDate
     * @param {string} currentOperationName
     * @param {Resource|Resource[]} incomingResources
     * @param {string} base_version
     * @returns {Promise<{preCheckErrors: MergeResultEntry[], validatedObjects: Resource[], wasAList: boolean}>}
     */
    // eslint-disable-next-line no-unused-vars
    async validate ({ requestInfo, currentDate, currentOperationName, incomingResources, base_version }) {
        throw Error('Not implemented');
    }
}

module.exports = {
    BaseValidator
};
