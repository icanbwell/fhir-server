const {assertTypeEquals, assertIsValid} = require('../../utils/assertType');
const {ConfigManager} = require('../../utils/configManager');
const {OpenAIEmbeddings} = require('langchain/embeddings/openai');
const {BaseVectorStoreManager} = require('./baseVectorStoreManager');
const {MongoClient} = require('mongodb');
const {MongoDBAtlasVectorSearch} = require('langchain/vectorstores/mongodb_atlas');

/**
 * @classdesc Implementation of VectorStoreFactory that creates a vector store in memory
 */
class MongoAtlasVectorStoreManager extends BaseVectorStoreManager {
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
        return this.configManager.mongoAtlasVectorStoreUrl;
    }

    /**
     * creates a vector store
     * @returns {Promise<import('langchain/vectorstores').VectorStore>}
     */
    async createVectorStoreInternalAsync() {
        const client = new MongoClient(this.configManager.mongoAtlasVectorStoreUrl);
        const embeddings = new OpenAIEmbeddings();

        const collectionName = this.configManager.mongoAtlasVectorStoreCollection;
        const indexName = this.configManager.mongoAtlasVectorStoreIndexName;
        const dbName = this.configManager.mongoAtlasVectorStoreDb;
        const textKey = this.configManager.mongoAtlasVectorStoreTextKey;
        const embeddingKey = this.configManager.mongoAtlasVectorStoreEmbeddingKey;
        const collection = client.db(dbName).collection(collectionName);
        return new MongoDBAtlasVectorSearch(embeddings, {
            collection: collection,
            indexName: indexName,
            textKey: textKey,
            embeddingKey: embeddingKey
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
     * @returns {function(*): boolean| import('langchain/vectorstores/mongodb_atlas').MongoDBAtlasFilter}
     */
    getFilter(filter) {
        return /** @type {import('langchain/vectorstores/mongodb_atlas').MongoDBAtlasFilter}*/ {
            preFilter: {
                parentResourceType: filter.resourceType,
                parentUuid: filter.uuid
            }
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
}

module.exports = {
    MongoAtlasVectorStoreManager
};
