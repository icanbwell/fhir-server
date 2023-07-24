const {BaseFhirToDocumentConverter} = require('./baseFhirToDocumentConverter');
const {ChatGPTDocument} = require('../chatgptDocument');

class FhirToJsonDocumentConverter extends BaseFhirToDocumentConverter {
    /**
     * converts a FHIR bundle into documents for ChatGPT
     * @param {Bundle} bundle
     * @returns {Promise<ChatGPTDocument[]>}
     */
    async convertBundleToDocumentsAsync({bundle}) {
        return bundle.entry.map(
            e => {
                return new ChatGPTDocument(
                    {
                        content: JSON.stringify(e.resource),
                        metadata: {
                            id: e.resource.id,
                            reference: `${e.resource.resourceType}/${e.resource.id}`,
                            resourceType: e.resource.resourceType
                        }
                    });
            }
        );
    }
}

module.exports = {
    FhirToJsonDocumentConverter
};
