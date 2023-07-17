const {BaseFhirToDocumentConverter} = require('./baseFhirToDocumentConverter');

class ChatGPTFhirToDocumentSplitter extends BaseFhirToDocumentConverter {
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
        let currentResourceIndex = 0;
        const totalResources = resources.length;
        for (const resource of resources) {
            currentResourceIndex++;
            const resourceContent = JSON.stringify(resource);
            const content = 'Do not answer yet. This is just another part of the text I want to send you. ' +
                `Just receive and acknowledge as "Part ${currentResourceIndex}/${totalResources} received" and wait for the next part.` +
                `\n[START PART ${currentResourceIndex}/${totalResources}]` +
                `\n${resourceContent}` +
                `\n[END PART ${currentResourceIndex}/${totalResources}]` +
                `\nRemember not answering yet. Just acknowledge you received this part with the message "Part ${currentResourceIndex}/${totalResources} received" and wait for the next part.`;
            documents.push({pageContent: content, metadata: {'id': `${resource.resourceType}/${resource.id}`}});
        }

        return documents;
    }
}

module.exports = {
    ChatGPTFhirToDocumentSplitter
};
