const {VectorStoreFactory} = require('./vectorStoreFactory');
const {Client} = require('@opensearch-project/opensearch');
const {assertTypeEquals} = require('../../utils/assertType');
const {ConfigManager} = require('../../utils/configManager');
const {FhirOpenSearchVectorStore} = require('./fhirOpenSearchVectorStore');
const {OpenAIEmbeddings} = require('langchain/embeddings/openai');

/**
 * @classdesc Implementation of VectorStoreFactory that creates a vector store in memory
 */
class OpenSearchVectorStoreFactory extends VectorStoreFactory {
    /**
     * constructor
     * @param {ConfigManager} configManager
     */
    constructor({
                    configManager
                }) {
        super();

        /**
         * @type {ConfigManager}
         */
        this.configManager = configManager;
        assertTypeEquals(configManager, ConfigManager);
    }

    /**
     * creates a vector store from a list of langchain documents
     * @returns {Promise<import('langchain/vectorstores').VectorStore>}
     */
    async createVectorStoreAsync() {
        const client = new Client({
            nodes: [this.configManager.openSearchVectorStoreUrl],
        });
        const embeddings = new OpenAIEmbeddings();

        return new FhirOpenSearchVectorStore(embeddings, {
            client,
            indexName: this.configManager.openSearchVectorStoreIndexName, // Will default to `documents`
        });
    }

    /**
     * gets a filter for the vector store
     * @param {{resourceType: string, id: string}} filter
     * @returns {function(*): boolean| import('langchain/vectorstores').OpenSearchFilter}
     */
    getFilter(filter) {
        // OpenSearchFilter is just of type object
        // noinspection JSValidateTypes
        return {
            parentResourceType: filter.resourceType,
            parentId: filter.id
        };
    }
}

module.exports = {
    OpenSearchVectorStoreFactory
};
