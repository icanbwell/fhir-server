class BaseValidator {
    /**
     * @param {FhirRequestInfo} requestInfo
     * @param {Resource|Resource[]} incomingResources
     * @param {string} base_version
     * @param {boolean} effectiveSmartMerge
     * @returns {Promise<{preCheckErrors: MergeResultEntry[], validatedObjects: Resource[], wasAList: boolean}>}
     */

    async validate ({ requestInfo, incomingResources, base_version, effectiveSmartMerge }) {
        throw Error('Not implemented');
    }
}

module.exports = {
    BaseValidator
};
