const {Document} = require('langchain/document');
const {assertIsValid} = require('../../utils/assertType');

/**
 * @classdesc Base class for VectorStoreManager
 */
class BaseVectorStoreManager {
    constructor () {
        /**
         * Reuse the vector store otherwise we would create a new one everytime
         * @type {import('langchain/vectorstores').VectorStore}
         */
        this.vectorStore = null;
    }

    /**
     * adds documents to the vector store
     * @param {ChatGPTDocument[]} documents
     */
    async addDocumentsAsync ({documents}) {
        /**
         * @type {import('langchain/document').Document[]}
         */
        const langChainDocuments = this.convertToLangChainDocuments({documents});
        await this.createVectorStoreAsync();
        assertIsValid(this.vectorStore, 'vectorStore must be set');
        await this.vectorStore.addDocuments(langChainDocuments);
    }

    /**
     * returns whether the vector store is enabled
     * @returns {Promise<boolean>}
     */
    async isEnabledAsync () {
        throw new Error('Not Implemented by subclass');
    }

    /**
     * creates a vector store from a list of langchain documents
     * @returns {Promise<import('langchain/vectorstores').VectorStore>}
     */
    // eslint-disable-next-line no-unused-vars
    async createVectorStoreAsync () {
        throw new Error('Not Implemented by subclass');
    }

    /**
     * converts a list of documents to a list of langchain documents
     * @param {ChatGPTDocument[]} documents
     * @returns {import('langchain/document').Document[]}
     */
    convertToLangChainDocuments ({documents}) {
        return documents.map(
            doc => new Document(
                {
                    pageContent: doc.content,
                    metadata: doc.metadata
                }
            ));
    }

    /**
     * returns a filter for the vector store.  Each type of vector store has a different type of filter
     * @param {VectorStoreFilter} filter
     * @returns {function(*): boolean| import('langchain/vectorstores').OpenSearchFilter}
     */
    // eslint-disable-next-line no-unused-vars
    getFilter (filter) {
        throw new Error('Not Implemented by subclass');
    }

    /**
     * returns a retriever for the vector store.  Each type of vector store has a different type of retriever
     * @param {VectorStoreFilter} filter
     * @return {import('langchain/schema/retriever').BaseRetriever}
     */
    // eslint-disable-next-line no-unused-vars
    asRetriever ({filter}) {
        throw new Error('Not Implemented by subclass');
    }
}

module.exports = {
    BaseVectorStoreManager
};
