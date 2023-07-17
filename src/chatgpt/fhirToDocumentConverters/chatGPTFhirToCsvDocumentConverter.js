const {groupByLambda} = require('../../utils/list.util');
const {Parser} = require('@json2csv/plainjs');
const {BaseFhirToDocumentConverter} = require('./baseFhirToDocumentConverter');

class ChatGPTFhirToCsvDocumentConverter extends BaseFhirToDocumentConverter{
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
         * merge results grouped by resourceType
         * @type {Object}
         */
        const groupByResourceType = groupByLambda(resources, requestedResource => {
            return requestedResource.resourceType;
        });

        const opts = {};
        const parser = new Parser(opts);
        /**
         * @type {{pageContent: string, metadata: Object}[]}
         */
        const documents = [];
        for (
            const [
                /** @type {string} */ resourceType,
                /** @type {Resource[]} */ resources1
            ]
            of Object.entries(groupByResourceType)
            ) {
            const csv = parser.parse(resources1);
            documents.push({pageContent: csv, metadata: resourceType});
        }

        return documents;
    }
}

module.exports = {
    ChatGPTFhirToCsvDocumentConverter
};
