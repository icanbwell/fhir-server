const {BaseFhirToDocumentConverter} = require('./baseFhirToDocumentConverter');
const {ChatGPTDocument} = require('../structures/chatgptDocument');

class FhirToJsonDocumentConverter extends BaseFhirToDocumentConverter {
    /**
     * converts a FHIR bundle into documents for ChatGPT
     * @param {string} resourceType
     * @param {string} id
     * @param {Bundle} bundle
     * @returns {Promise<ChatGPTDocument[]>}
     */
    async convertBundleToDocumentsAsync({resourceType, id, bundle}) {
        return bundle.entry.map(
            e => {
                return new ChatGPTDocument(
                    {
                        content: JSON.stringify(e.resource),
                        metadata: {
                            _id: `${e.resource.resourceType}/${e.resource.id}`,
                            id: e.resource.id,
                            reference: `${e.resource.resourceType}/${e.resource.id}`,
                            resourceType: e.resource.resourceType,
                            parentResourceType: resourceType,
                            parentId: id
                        }
                    });
            }
        );
    }
}

module.exports = {
    FhirToJsonDocumentConverter
};
