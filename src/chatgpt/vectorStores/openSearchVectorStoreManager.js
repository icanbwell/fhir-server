const {Client} = require('@opensearch-project/opensearch');
const {assertTypeEquals, assertIsValid} = require('../../utils/assertType');
const {ConfigManager} = require('../../utils/configManager');
const {FhirOpenSearchVectorStore} = require('./fhirOpenSearchVectorStore');
const {OpenAIEmbeddings} = require('langchain/embeddings/openai');
const {BaseVectorStoreManager} = require('./baseVectorStoreManager');
const {ChatGPTDocument} = require('../structures/chatgptDocument');
const {ChatGPTMeta} = require('../structures/chatgptMeta');

/**
 * @classdesc Implementation of VectorStoreFactory that creates a vector store in memory
 */
class OpenSearchVectorStoreManager extends BaseVectorStoreManager {
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
     * returns whether the vector store is enabled
     * @returns {Promise<boolean>}
     */
    async isEnabledAsync() {
        return this.configManager.openSearchVectorStoreUrl;
    }

    /**
     * creates a vector store
     * @returns {Promise<import('langchain/vectorstores').VectorStore>}
     */
    async createVectorStoreInternalAsync() {
        let openSearchVectorStoreUrl = this.configManager.openSearchVectorStoreUrl;
        if (this.configManager.openSearchVectorStoreUserName !== undefined) {
            openSearchVectorStoreUrl = openSearchVectorStoreUrl.replace(
                'https://',
                `https://${this.configManager.openSearchVectorStoreUserName}:${this.configManager.openSearchVectorStorePassword}@`
            );
            openSearchVectorStoreUrl = openSearchVectorStoreUrl.replace(
                'http://',
                `http://${this.configManager.openSearchVectorStoreUserName}:${this.configManager.openSearchVectorStorePassword}@`
            );
        }

        const client = new Client({
            nodes: [openSearchVectorStoreUrl],
        });
        const embeddings = new OpenAIEmbeddings();

        const indexName = this.configManager.openSearchVectorStoreIndexName;
        assertIsValid(indexName === indexName.toLowerCase(), 'openSearchVectorStoreIndexName must be lowercase');
        return new FhirOpenSearchVectorStore(embeddings, {
            client,
            indexName: indexName,
        });
    }

    /**
     * creates a vector store from a list of langchain documents
     * @returns {Promise<import('langchain/vectorstores').VectorStore>}
     */
    async createVectorStoreAsync() {
        if (!this.vectorStore) {
            this.vectorStore = await this.createVectorStoreInternalAsync();
        }
        return this.vectorStore;
    }

    /**
     * gets a filter for the vector store
     * @param {VectorStoreFilter} filter
     * @returns {function(*): boolean| import('langchain/vectorstores/opensearch').OpenSearchFilter}
     */
    getFilter(filter) {
        // OpenSearchFilter is just of type object
        return /** @type {import('langchain/vectorstores').OpenSearchFilter}*/ {
            parentResourceType: filter.resourceType,
            parentUuid: filter.uuid
        };
    }

    /**
     * returns a retriever for the vector store.  Each type of vector store has a different type of retriever
     * @param {VectorStoreFilter|undefined} [filter]
     * @return {import('langchain/schema/retriever').BaseRetriever}
     */
    asRetriever({filter}) {
        assertIsValid(this.vectorStore, 'vectorStore was not initialized.  Call createVectorStoreAsync() first');
        return this.vectorStore.asRetriever(10, filter ? this.getFilter(filter) : undefined);
    }

    /**
     * searches the vector store for the provided text
     * @param {VectorStoreFilter} filter
     * @param {string} text
     * @param {number|undefined} [limit]
     * @return {Promise<ChatGPTDocument[]>}
     */
    async searchAsync({filter, text, limit}) {
        assertIsValid(this.vectorStore, 'vectorStore was not initialized.  Call createVectorStoreAsync() first');
        /**
         * @type {[Document, number][]}
         */
        const results = await this.vectorStore.similaritySearchWithScore(
            text,
            limit,
            this.getFilter(filter)
        );
        return results.map(
            ([doc, _]) => new ChatGPTDocument(
                {
                    content: doc.pageContent,
                    metadata: new ChatGPTMeta(doc.metadata)
                }
            )
        );
    }
}

module.exports = {
    OpenSearchVectorStoreManager
};
