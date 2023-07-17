class BaseFhirToDocumentConverter {
    /**
     * converts a FHIR bundle into documents for ChatGPT
     * @param {Bundle} bundle
     * @returns {Promise<{pageContent: string, metadata: Object}[]>}
     */
    // eslint-disable-next-line no-unused-vars
    async convertBundleToDocumentsAsync({bundle}) {
        throw new Error('Not Implemented by subclass');

    }
}

module.exports = {
    BaseFhirToDocumentConverter
};
