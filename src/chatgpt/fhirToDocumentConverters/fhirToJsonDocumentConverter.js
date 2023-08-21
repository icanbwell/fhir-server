const {BaseFhirToDocumentConverter} = require('./baseFhirToDocumentConverter');
const {ChatGPTDocument} = require('../structures/chatgptDocument');
const {ChatGPTMeta} = require('../structures/chatgptMeta');

class FhirToJsonDocumentConverter extends BaseFhirToDocumentConverter {
    /**
     * converts a FHIR bundle into documents for ChatGPT
     * @param {string} resourceType
     * @param {string} uuid
     * @param {Bundle} bundle
     * @returns {Promise<ChatGPTDocument[]>}
     */
    async convertBundleToDocumentsAsync({resourceType, uuid, bundle}) {
        return bundle.entry.map(
            e => {
                return new ChatGPTDocument(
                    {
                        content: JSON.stringify(e.resource),
                        metadata: new ChatGPTMeta({
                            _id: `${e.resource.resourceType}/${e.resource.id}`,
                            uuid: e.resource._uuid,
                            reference: `${e.resource.resourceType}/${e.resource.id}`,
                            resourceType: e.resource.resourceType,
                            parentResourceType: resourceType,
                            parentUuid: uuid
                        })
                    });
            }
        );
    }
}

module.exports = {
    FhirToJsonDocumentConverter
};
