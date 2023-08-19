const {VectorStoreFactory} = require('./vectorStoreFactory');
const {MemoryVectorStore} = require('langchain/vectorstores/memory');
const {OpenAIEmbeddings} = require('langchain/embeddings/openai');

/**
 * @classdesc Implementation of VectorStoreFactory that creates a vector store in memory
 */
class MemoryVectorStoreFactory extends VectorStoreFactory {
    /**
     * creates a vector store from a list of langchain documents
     * @returns {Promise<import('langchain/vectorstores').VectorStore>}
     */
    async createVectorStoreAsync() {
        const embeddings = new OpenAIEmbeddings();
        return new MemoryVectorStore(embeddings);
    }

    /**
     * returns a filter for the vector store.  Each type of vector store has a different type of filter
     * @param {{resourceType: string, id: string}} filter
     * @returns {function(*): boolean| import('langchain/vectorstores').OpenSearchFilter}
     */
    getFilter(filter) {
        return (document) => (document.metadata.resourceType === filter.resourceType && document.metadata.id === filter.id) ||
            (document.metadata.parentResourceType === filter.resourceType && document.metadata.parentId === filter.id);
    }
}

module.exports = {
    MemoryVectorStoreFactory
};
