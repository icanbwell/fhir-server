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

    /**
     * returns a filter for the vector store.  Each type of vector store has a different type of filter
     * @param {{resourceType: string, id: string}} filter
     * @returns {function(*): boolean| import('langchain/vectorstores').OpenSearchFilter}
     */
    getFilter(filter) {
        return (document) => document.metadata.resourceType === filter.resourceType && document.metadata.id === filter.id;
    }
}

module.exports = {
    MemoryVectorStoreFactory
};
