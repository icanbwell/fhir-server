/**
 * Abstract base class for an enrichment provider.  Inherit from this to create a new enrichment provider
 */
class QueryRewriter {
    /**
     * rewrites the query
     * @param {string} base_version
     * @param {import('mongodb').Document} query
     * @param {Set} columns
     * @return {Promise<{query:import('mongodb').Document,columns:Set}>}
     */
    // eslint-disable-next-line no-unused-vars
    async rewriteQueryAsync({base_version, query, columns}) {
        return {query, columns};
    }

    /**
     * rewrites the args
     * @param {string} base_version
     * @param {Object} args
     * @return {Promise<Object>}
     */
    // eslint-disable-next-line no-unused-vars
    async rewriteArgsAsync({base_version, args}) {
        return args;
    }
}

module.exports = {
    QueryRewriter
};
