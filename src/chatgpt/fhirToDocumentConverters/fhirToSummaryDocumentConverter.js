const {BaseFhirToDocumentConverter} = require('./baseFhirToDocumentConverter');

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
     * @returns {Promise<{pageContent: string, metadata: Object}[]>}
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
         * @type {{pageContent: string, metadata: Object}[]}
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
            documents.push({pageContent: content, metadata: {'id': `${resource.resourceType}/${resource.id}`}});
        }

        return documents;
    }
}

module.exports = {
    FhirToSummaryDocumentConverter
};
