const {BaseFhirToDocumentConverter} = require('./baseFhirToDocumentConverter');
const {ChatGPTDocument} = require('../structures/chatgptDocument');
const {ChatGPTMeta} = require('../structures/chatgptMeta');

class FhirToSummaryDocumentConverter extends BaseFhirToDocumentConverter {
    /**
     * constructor
     * @param {ResourceConverterFactory} resourceConverterFactory
     */
    constructor({resourceConverterFactory}) {
        super();
        /**
         * @type {ResourceConverterFactory}
         */
        this.resourceConverterFactory = resourceConverterFactory;
    }

    /**
     * converts a FHIR bundle into documents for ChatGPT
     * @param {string} resourceType
     * @param {string} uuid
     * @param {Bundle} bundle
     * @returns {Promise<ChatGPTDocument[]>}
     */
    async convertBundleToDocumentsAsync({resourceType, uuid, bundle}) {
        // group by resource type
        /**
         * @type {Resource[]}
         */
        const resources = bundle.entry.map(
            e => e.resource
        );
        /**
         * @type {ChatGPTDocument[]}
         */
        const documents = [];
        for (const resource of resources) {
            // currentResourceIndex++;
            /**
             * @type {BaseConverter|undefined}
             */
            const resourceConverter = this.resourceConverterFactory.getConverterForResource(
                {
                    resource
                }
            );
            const content = resourceConverter ? resourceConverter.convert({resource}) : JSON.stringify(resource);
            documents.push(
                new ChatGPTDocument(
                    {
                        content: content,
                        metadata: new ChatGPTMeta({
                            _id: `${resource.resourceType}/${resource.id}`,
                            uuid: resource._uuid,
                            reference: `${resource.resourceType}/${resource.id}`,
                            resourceType: resource.resourceType,
                            parentResourceType: resourceType,
                            parentUuid: uuid
                        })
                    }
                )
            );
        }

        return documents;
    }
}

module.exports = {
    FhirToSummaryDocumentConverter
};
