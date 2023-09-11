class BaseFhirToDocumentConverter {
    /**
     * converts a FHIR bundle into documents for ChatGPT
     * @param {string} parentResourceType
     * @param {string} parentUuid
     * @param {Bundle} bundle
     * @returns {Promise<ChatGPTDocument[]>}
     */
    // eslint-disable-next-line no-unused-vars
    async convertBundleToDocumentsAsync({parentResourceType, parentUuid, bundle}) {
        throw new Error('Not Implemented by subclass');

    }
}

module.exports = {
    BaseFhirToDocumentConverter
};
