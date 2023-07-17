const {BaseFhirToDocumentConverter} = require('./baseFhirToDocumentConverter');

class FhirToJsonDocumentConverter extends BaseFhirToDocumentConverter{
    /**
     * converts a FHIR bundle into documents for ChatGPT
     * @param {Bundle} bundle
     * @returns {Promise<{pageContent: string, metadata: Object}[]>}
     */
    async convertBundleToDocumentsAsync({bundle}) {
        return bundle.entry.map(
            e => {
                return {
                    pageContent: JSON.stringify(e.resource),
                    metadata: {
                        'my_document_id': e.resource.id,
                    },
                };
            }
        );
    }
}

module.exports = {
    FhirToJsonDocumentConverter
};
