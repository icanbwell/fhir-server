const {Document} = require('langchain/document');

/**
 * @classdesc Base factory to create a vector store from documents
 */
class VectorStoreFactory {
    /**
     * adds documents to the vector store
     * @param {import('langchain/vectorstores').VectorStore} vectorStore
     * @param {ChatGPTDocument[]} documents
     */
    async addDocumentsAsync({vectorStore, documents}) {
        /**
         * @type {import('langchain/document').Document[]}
         */
        const langChainDocuments = this.convertToLangChainDocuments({documents});
        await vectorStore.addDocuments(langChainDocuments);
    }

    /**
     * creates a vector store from a list of langchain documents
     * @returns {Promise<import('langchain/vectorstores').VectorStore>}
     */
    // eslint-disable-next-line no-unused-vars
    async createVectorStoreAsync() {
        throw new Error('Not Implemented by subclass');
    }

    /**
     * converts a list of documents to a list of langchain documents
     * @param {ChatGPTDocument[]} documents
     * @returns {import('langchain/document').Document[]}
     */
    convertToLangChainDocuments({documents}) {
        return documents.map(
            doc => new Document(
                {
                    pageContent: doc.content,
                    metadata: doc.metadata,
                }
            ));
    }

    /**
     * returns a filter for the vector store.  Each type of vector store has a different type of filter
     * @param {{resourceType: string, id: string}} filter
     * @returns {function(*): boolean| import('langchain/vectorstores').OpenSearchFilter}
     */
    // eslint-disable-next-line no-unused-vars
    getFilter(filter) {
        throw new Error('Not Implemented by subclass');
    }
}

module.exports = {
    VectorStoreFactory
};
