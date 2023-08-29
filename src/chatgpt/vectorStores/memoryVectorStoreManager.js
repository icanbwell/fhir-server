const {MemoryVectorStore} = require('langchain/vectorstores/memory');
const {OpenAIEmbeddings} = require('langchain/embeddings/openai');
const {BaseVectorStoreManager} = require('./baseVectorStoreManager');
const {assertIsValid, assertTypeEquals} = require('../../utils/assertType');
const {ConfigManager} = require('../../utils/configManager');
const {ChatGPTDocument} = require('../structures/chatgptDocument');
const {ChatGPTMeta} = require('../structures/chatgptMeta');

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
        if (filter.resourceType && filter.uuid) {
            return document => (document.metadata.resourceType === filter.resourceType && document.metadata.uuid === filter.uuid);
        }
        if (filter.resourceType) {
            return document => (document.metadata.resourceType === filter.resourceType);
        }
        if (filter.parentResourceType && filter.parentUuid) {
            return document => (document.metadata.parentResourceType === filter.parentResourceType &&
                document.metadata.parentUuid === filter.parentUuid);
        }
        throw new Error('Either resourceType, uuid or parentResourceType+parentUuid must be set');
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
     * clears the vector store
     * @returns {Promise<void>}
     */
    async clearAsync() {
        if (this.vectorStore) {
            this.vectorStore = await this.createVectorStoreInternalAsync();
        }
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
            filter ? this.getFilter(filter) : null
        );
        return results.map(
            ([doc, score]) => new ChatGPTDocument(
                {
                    content: doc.pageContent,
                    metadata: new ChatGPTMeta({
                            ...doc.metadata,
                            'similarity': score
                        }
                    )
                }
            )
        );
    }
}

module.exports = {
    MemoryVectorStoreManager
};
