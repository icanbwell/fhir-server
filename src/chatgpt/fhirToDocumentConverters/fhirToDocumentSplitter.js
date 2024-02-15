const {BaseFhirToDocumentConverter} = require('./baseFhirToDocumentConverter');
const {ChatGPTDocument} = require('../structures/chatgptDocument');
const {ChatGPTMeta} = require('../structures/chatgptMeta');

class FhirToDocumentSplitter extends BaseFhirToDocumentConverter {
    /**
     * converts a FHIR bundle into documents for ChatGPT
     * @param {string} parentResourceType
     * @param {string} parentUuid
     * @param {Bundle} bundle
     * @returns {Promise<ChatGPTDocument[]>}
     */
    // eslint-disable-next-line no-unused-vars
    async convertBundleToDocumentsAsync ({parentResourceType, parentUuid, bundle}) {
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
                `\nRemember not answering yet. Just acknowledge you received this part with the message'+
                '\n "Part ${currentResourceIndex}/${totalResources} received" and wait for the next part.`;
            documents.push(
                new ChatGPTDocument(
                    {
                        content: content,
                        metadata: new ChatGPTMeta({
                            _id: `${resource.resourceType}/${resource.id}`,
                            uuid: resource._uuid,
                            reference: `${resource.resourceType}/${resource.id}`,
                            resourceType: resource.resourceType,
                            parentResourceType: parentResourceType,
                            parentUuid: parentUuid
                        })
                    }
                )
            );
        }

        return documents;
    }
}

module.exports = {
    FhirToDocumentSplitter
};
