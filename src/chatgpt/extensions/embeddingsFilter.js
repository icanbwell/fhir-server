const {BaseDocumentCompressor} = require('langchain/retrievers/document_compressors');
const {cosineSimilarity} = require('langchain/util/math');
const {get_stateful_documents, _get_embeddings_from_stateful_docs} = require('./embeddings_redundant_filter');

/**
 * @classdesc This class is present in langchain python but not in javascript yet
 * so we converted this from python.  We should remove this once langchain js has this class
 * https://github.com/langchain-ai/langchain/blob/master/libs/langchain/langchain/retrievers/document_compressors/embeddings_filter.py
 */
class EmbeddingsFilter extends BaseDocumentCompressor {
    /**
     * constructor
     * @param {import('langchain/embeddings').Embeddings} embeddings
     * @param {function(X: number[][], Y: number[][]): number[][]} similarity_fn
     * @param {number|undefined} [k]
     * @param {number|undefined|null} [similarity_threshold]
     */
    constructor(
        {
            embeddings,
            similarity_fn = cosineSimilarity,
            k = 20,
            similarity_threshold = null
        }
    ) {
        super();
        /**
         * @type {import('langchain/embeddings').Embeddings}
         */
        this.embeddings = embeddings;
        /**
         * @type {function(number[][], number[][]): number[][]}
         */
        this.similarity_fn = similarity_fn;
        /**
         * @type {number|undefined}
         */
        this.k = k;
        /**
         * @type {float|undefined}
         */
        this.similarity_threshold = similarity_threshold;
    }

    // noinspection JSUnusedGlobalSymbols
    validate_params(values) {
        if (values['k'] === null && values['similarity_threshold'] === null) {
            throw new Error('Must specify one of `k` or `similarity_threshold`.');
        }
        return values;
    }

    /**
     * compresses the document
     * @param {import('langchain/document').Document[]} documents
     * @param {string} query
     * @return {Promise<import('langchain/document').Document[]>}
     */
    async compressDocuments(documents, query) {
        const stateful_documents = get_stateful_documents(documents);
        const embedded_documents = await _get_embeddings_from_stateful_docs(this.embeddings, stateful_documents);
        const embedded_query = await this.embeddings.embedQuery(query);
        const similarity = this.similarity_fn([embedded_query], embedded_documents)[0];
        let included_idxs = Array.from(
            {length: embedded_documents.length},
            (_, i) => i);
        if (this.k !== null) {
            included_idxs = similarity.map((val, idx) => [val, idx]).sort((a, b) => b[0] - a[0]).slice(0, this.k).map(([_, idx]) => idx);
        }
        if (this.similarity_threshold !== null) {
            const similar_enough = included_idxs.filter(idx => similarity[`${idx}`] > this.similarity_threshold);
            included_idxs = similar_enough;
        }
        return included_idxs.map(i => stateful_documents[`${i}`]);
    }
}

module.exports = {EmbeddingsFilter};
