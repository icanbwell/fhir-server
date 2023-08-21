class BaseFhirToDocumentConverter {
    /**
     * converts a FHIR bundle into documents for ChatGPT
     * @param {string} resourceType
     * @param {string} uuid
     * @param {Bundle} bundle
     * @returns {Promise<ChatGPTDocument[]>}
     */
    // eslint-disable-next-line no-unused-vars
    async convertBundleToDocumentsAsync({resourceType, uuid, bundle}) {
        throw new Error('Not Implemented by subclass');

    }
}

module.exports = {
    BaseFhirToDocumentConverter
};
