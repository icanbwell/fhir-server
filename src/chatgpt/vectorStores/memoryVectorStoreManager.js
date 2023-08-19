const {MemoryVectorStore} = require('langchain/vectorstores/memory');
const {OpenAIEmbeddings} = require('langchain/embeddings/openai');
const {BaseVectorStoreManager} = require('./baseVectorStoreManager');
const {assertIsValid, assertTypeEquals} = require('../../utils/assertType');
const {ConfigManager} = require('../../utils/configManager');

/**
 * @classdesc Implementation of VectorStoreFactory that creates a vector store in memory
 */
class MemoryVectorStoreManager extends BaseVectorStoreManager {
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
     * creates a vector store
     * @returns {Promise<MemoryVectorStore>}
     */
    async createVectorStoreInternalAsync() {
        /**
         * @type {OpenAIEmbeddings}
         */
        const embeddings = new OpenAIEmbeddings();
        return new MemoryVectorStore(embeddings);
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
     * returns whether the vector store is enabled
     * @returns {Promise<boolean>}
     */
    async isEnabledAsync() {
        return this.configManager.enableMemoryVectorStore;
    }

    /**
     * returns a filter for the vector store.  Each type of vector store has a different type of filter
     * @param {VectorStoreFilter} filter
     * @returns {function(*): boolean| import('langchain/vectorstores').OpenSearchFilter}
     */
    getFilter(filter) {
        return (document) => (document.metadata.resourceType === filter.resourceType && document.metadata.id === filter.id) ||
            (document.metadata.parentResourceType === filter.resourceType && document.metadata.parentId === filter.id);
    }

    /**
     * returns a retriever for the vector store.  Each type of vector store has a different type of retriever
     * @param {VectorStoreFilter|undefined} [filter]
     * @return {import('langchain/vectorstores').VectorStoreRetriever}
     */
    asRetriever({filter}) {
        assertIsValid(this.vectorStore, 'vectorStore was not initialized.  Call createVectorStoreAsync() first');
        return this.vectorStore.asRetriever(10, filter ? this.getFilter(filter) : undefined);
    }
}

module.exports = {
    MemoryVectorStoreManager
};
