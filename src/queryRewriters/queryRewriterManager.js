class QueryRewriterManager {
    /**
     * rewrites the query
     * @param {string} base_version
     * @param {import('mongodb').Document} query
     * @param {Set} columns
     * @return {Promise<{query:import('mongodb').Document,columns:Set}>}
     */
    // eslint-disable-next-line no-unused-vars
    async rewriteAsync({base_version, query, columns}) {
        return {query, columns};
    }
}

module.exports = {
    QueryRewriterManager
};
