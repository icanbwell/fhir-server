const { assertTypeEquals, assertIsValid } = require('../../utils/assertType');
const { ConfigManager } = require('../../utils/configManager');
const { OpenAIEmbeddings } = require('langchain/embeddings/openai');
const { BaseVectorStoreManager } = require('./baseVectorStoreManager');
const { MongoClient } = require('mongodb');
const { MongoDBAtlasVectorSearch } = require('langchain/vectorstores/mongodb_atlas');
const { RethrownError } = require('../../utils/rethrownError');

/**
 * @classdesc Implementation of VectorStoreFactory that creates a vector store in memory
 */
class MongoAtlasVectorStoreManager extends BaseVectorStoreManager {
    /**
     * constructor
     * @param {ConfigManager} configManager
     */
    constructor ({
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
    async isEnabledAsync () {
        return this.configManager.mongoAtlasVectorStoreUrl;
    }

    /**
     * creates a vector store
     * @returns {Promise<import('langchain/vectorstores').VectorStore>}
     */
    async createVectorStoreInternalAsync () {
        let mongoUrl = this.configManager.mongoAtlasVectorStoreUrl;
        const collectionName = this.configManager.mongoAtlasVectorStoreCollection;
        const indexName = this.configManager.mongoAtlasVectorStoreIndexName;
        const dbName = this.configManager.mongoAtlasVectorStoreDb;
        const textKey = this.configManager.mongoAtlasVectorStoreTextKey;
        const embeddingKey = this.configManager.mongoAtlasVectorStoreEmbeddingKey;
        try {
            if (this.configManager.mongoAtlasVectorStoreUserName !== undefined) {
                mongoUrl = mongoUrl.replace(
                    'mongodb://',
                    `mongodb://${this.configManager.mongoAtlasVectorStoreUserName}:${this.configManager.mongoAtlasVectorStorePassword}@`
                );
                mongoUrl = mongoUrl.replace(
                    'mongodb+srv://',
                    `mongodb+srv://${this.configManager.mongoAtlasVectorStoreUserName}:${this.configManager.mongoAtlasVectorStorePassword}@`
                );
            }
            const client = new MongoClient(mongoUrl);
            const embeddings = new OpenAIEmbeddings();

            const collection = client.db(dbName).collection(collectionName);
            return new MongoDBAtlasVectorSearch(embeddings, {
                collection,
                indexName,
                textKey,
                embeddingKey
            });
        } catch (e) {
            throw new RethrownError(
                {
                    message: `MongoAtlasVectorStoreManager: ${e.message}`,
                    error: e,
                    args: {
                        mongoAtlasVectorStoreUrl: this.configManager.mongoAtlasVectorStoreUrl,
                        collectionName,
                        dbName,
                        indexName,
                        textKey,
                        embeddingKey
                    }
                }
            );
        }
    }

    /**
     * creates a vector store from a list of langchain documents
     * @returns {Promise<import('langchain/vectorstores').VectorStore>}
     */
    async createVectorStoreAsync () {
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
    getFilter (filter) {
        // https://www.mongodb.com/docs/atlas/atlas-search/operators-and-collectors
        return /** @type {import('langchain/vectorstores/mongodb_atlas').MongoDBAtlasFilter} */ {
            compound: {
                should: [
                    {
                        phrase: {
                            path: 'parentResourceType',
                            query: filter.resourceType
                        }
                    },
                    {
                        phrase: {
                            path: 'parentUuid',
                            query: filter.uuid
                        }
                    }

                ]
            }
        };
    }

    /**
     * returns a retriever for the vector store.  Each type of vector store has a different type of retriever
     * @param {VectorStoreFilter|undefined} [filter]
     * @return {import('langchain/schema/retriever').BaseRetriever}
     */
    asRetriever ({ filter }) {
        assertIsValid(this.vectorStore, 'vectorStore was not initialized.  Call createVectorStoreAsync() first');
        return this.vectorStore.asRetriever({
                filter: this.getFilter(filter)
            }
        );
    }
}

module.exports = {
    MongoAtlasVectorStoreManager
};
