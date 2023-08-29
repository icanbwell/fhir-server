/**
 * This file is converted since it is in python but not yet in javascript
 * https://github.com/langchain-ai/langchain/blob/master/libs/langchain/langchain/document_transformers/embeddings_redundant_filter.py
 */
const {Document} = require('langchain/document');

class _DocumentWithState extends Document {
    constructor({pageContent, metadata, state = {}}) {
        super({pageContent, metadata});
        this.state = state;
    }

    // noinspection JSUnusedGlobalSymbols
    to_document() {
        return new Document({pageContent: this.pageContent, metadata: this.metadata});
    }

    static from_document(doc) {
        if (doc instanceof this) {
            return doc;
        }
        return new _DocumentWithState(
            {
                pageContent: doc.pageContent,
                metadata: doc.metadata
            }
        );
    }
}

/**
 * gets stateful docs
 * @param {import('langchain/document').Document[]} documents
 * @return {_DocumentWithState[]}
 */
function get_stateful_documents(documents) {
    return documents.map(doc => _DocumentWithState.from_document(doc));
}

/**
 * zips two arrays
 * @param arrays
 * @return {*[][]}
 */
function zip(...arrays) {
    const length = Math.min(...arrays.map(arr => arr.length));
    return Array.from({length}, (_, i) => arrays.map(array => array[`${i}`]));
}

/**
 * gets embeddings from stateful docs
 * @param {import('langchain/embeddings').Embeddings} embeddings
 * @param {_DocumentWithState[]} documents
 * @return {Promise<number[][]>}
 */
async function _get_embeddings_from_stateful_docs(embeddings, documents) {
    let embedded_documents;
    if (documents.length && 'embedded_doc' in documents[0].state) {
        embedded_documents = documents.map(doc => doc.state['embedded_doc']);
    } else {
        embedded_documents = await embeddings.embedDocuments(documents.map(d => d.pageContent));
        for (const [doc, embedding] of zip(documents, embedded_documents)) {
            doc.state['embedded_doc'] = embedding;
        }
    }
    return embedded_documents;
}


module.exports = {
    get_stateful_documents,
    _get_embeddings_from_stateful_docs
};
