const {VectorStoreFactory} = require('./vectorStoreFactory');
const {Client} = require('@opensearch-project/opensearch');
const {OpenSearchVectorStore} = require('langchain/vectorstores/opensearch');
const {assertTypeEquals} = require('../../utils/assertType');
const {ConfigManager} = require('../../utils/configManager');

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
     * @param {import('langchain/document').Document[]} langChainDocuments
     * @param {import('langchain/embeddings').Embeddings} embeddings
     * @returns {Promise<import('langchain/vectorstores').VectorStore>}
     */
    async createVectorStoreAsync({langChainDocuments, embeddings}) {
        const client = new Client({
            nodes: [this.configManager.openSearchVectorStoreUrl],
        });
        return await OpenSearchVectorStore.fromDocuments(
            langChainDocuments,
            embeddings, {
                client,
                indexName: this.configManager.openSearchVectorStoreIndexName, // Will default to `documents`
            }
        );
    }
}

module.exports = {
    OpenSearchVectorStoreFactory
};
