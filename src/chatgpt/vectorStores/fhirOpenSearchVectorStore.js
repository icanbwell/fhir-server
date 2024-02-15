const {OpenSearchVectorStore} = require('langchain/vectorstores/opensearch');

/**
 * @classdesc Subclass of OpenSearchVectorStore that uses the document _id as the _id
 * which allows us to replace documents
 */
class FhirOpenSearchVectorStore extends OpenSearchVectorStore {
    async addVectors(vectors, documents) {
        await this.ensureIndexExists(
            vectors[0].length,
            this.engine,
            this.spaceType,
            this.efSearch,
            this.efConstruction,
            this.m
        );
        const operations = vectors.flatMap((embedding, idx) => [
            {
                index: {
                    _index: this.indexName,
                    _id: documents[`${idx}`].metadata._id
                }
            },
            {
                embedding,
                metadata: documents[`${idx}`].metadata,
                text: documents[`${idx}`].pageContent
            }
        ]);
        await this.client.bulk({body: operations});
        await this.client.indices.refresh({index: this.indexName});
    }
}

module.exports = {
    FhirOpenSearchVectorStore
};
