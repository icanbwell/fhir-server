const {BaseFhirToDocumentConverter} = require('./baseFhirToDocumentConverter');
const {ChatGPTDocument} = require('../chatgptDocument');

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
     * @param {Bundle} bundle
     * @returns {Promise<ChatGPTDocument[]>}
     */
    async convertBundleToDocumentsAsync({bundle}) {
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
                        metadata: {
                            id: resource.id,
                            reference: `${resource.resourceType}/${resource.id}`,
                            resourceType: resource.resourceType
                        }
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
