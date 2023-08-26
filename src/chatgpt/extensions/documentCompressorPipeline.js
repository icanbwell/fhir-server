const {BaseDocumentCompressor} = require('langchain/retrievers/document_compressors');

class DocumentCompressorPipeline extends BaseDocumentCompressor {
    /**
     * constructor
     * @param {(import('langchain/retrievers/document_compressors').BaseDocumentCompressor|import('langchain/document').BaseDocumentTransformer)[]} transformers
     */
    constructor({transformers}) {
        super();
        /**
         * @type {(import('langchain/retrievers/document_compressors').BaseDocumentCompressor|import('langchain/document').BaseDocumentTransformer)[]}
         */
        this.transformers = transformers;
    }

    /**
     * compresses the document
     * @param {import('langchain/document').Document[]} documents
     * @param {string} query
     * @return {Promise<import('langchain/document').Document[]>}
     */
    async compressDocuments(documents, query) {
        for (let _transformer of this.transformers) {
            if ( _transformer instanceof BaseDocumentCompressor) {
                documents = await _transformer.compressDocuments(documents, query);
            } else if (typeof _transformer.transformDocuments === 'function' /*instanceof BaseDocumentTransformer*/) {
                documents = await _transformer.transformDocuments(documents);
            } else {
                throw new Error(`Got unexpected transformer type: ${_transformer}`);
            }
        }
        return documents;
    }
}

module.exports = {
    DocumentCompressorPipeline
};
