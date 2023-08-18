const {Document} = require('langchain/document');
const {OpenAIEmbeddings} = require('langchain/embeddings/openai');

/**
 * @classdesc Base factory to create a vector store from documents
 */
class VectorStoreFactory {
    /**
     * returns a vector store from a list of documents
     * @param {ChatGPTDocument[]} documents
     * @returns {Promise<import('langchain/vectorstores').VectorStore>}
     */
    async fromDocumentsAsync({documents}) {
        /**
         * @type {import('langchain/document').Document[]}
         */
        const langChainDocuments = this.convertToLangChainDocuments({documents});
        const embeddings = new OpenAIEmbeddings();
        return await this.createVectorStoreAsync({langChainDocuments, embeddings});
    }

    /**
     * creates a vector store from a list of langchain documents
     * @param {import('langchain/document').Document[]} langChainDocuments
     * @param {import('langchain/embeddings').Embeddings} embeddings
     * @returns {Promise<import('langchain/vectorstores').VectorStore>}
     */
    // eslint-disable-next-line no-unused-vars
    async createVectorStoreAsync({langChainDocuments, embeddings}) {
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
