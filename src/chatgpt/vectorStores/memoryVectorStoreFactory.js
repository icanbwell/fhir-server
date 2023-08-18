const {VectorStoreFactory} = require('./vectorStoreFactory');
const {MemoryVectorStore} = require('langchain/vectorstores/memory');

/**
 * @classdesc Implementation of VectorStoreFactory that creates a vector store in memory
 */
class MemoryVectorStoreFactory extends VectorStoreFactory {
    /**
     * creates a vector store from a list of langchain documents
     * @param {import('langchain/document').Document[]} langChainDocuments
     * @param {import('langchain/embeddings').Embeddings} embeddings
     * @returns {Promise<import('langchain/vectorstores').VectorStore>}
     */
    async createVectorStoreAsync({langChainDocuments, embeddings}) {
        return await MemoryVectorStore.fromDocuments(
            langChainDocuments,
            embeddings
        );
    }
}

module.exports = {
    MemoryVectorStoreFactory
};
