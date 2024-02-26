class PreSaveHandler {
    /**
     * fixes up any resources before they are saved
     * @param {string} base_version
     * @param {FhirRequestInfo} requestInfo
     * @param {Resource} resource
     * @returns {Promise<Resource>}
     */
    // eslint-disable-next-line no-unused-vars
    async preSaveAsync ({ base_version, requestInfo, resource }) {
        throw Error('Not Implemented');
    }
}

module.exports = {
    PreSaveHandler
};
