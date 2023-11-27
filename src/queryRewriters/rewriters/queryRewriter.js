/**
 * Abstract base class for an enrichment provider.  Inherit from this to create a new enrichment provider
 */
class QueryRewriter {
    /**
     * rewrites the query
     * @param {string} base_version
     * @param {import('mongodb').Document} query
     * @param {Set} columns
     * @param {string} resourceType
     * @param {'GET'|'POST'|'PUT'|'PATCH'|'DELETE'} method
     * @return {Promise<{query:import('mongodb').Document,columns:Set}>}
     */
    // eslint-disable-next-line no-unused-vars
    async rewriteQueryAsync({base_version, query, columns, resourceType, method}) {
        return {query, columns};
    }

    /**
     * rewrites the args
     * @param {string} base_version
     * @param {ParsedArgs} parsedArgs
     * @param {string} resourceType
     * @param {'GET'|'POST'|'PUT'|'PATCH'|'DELETE'} method
     * @return {Promise<ParsedArgs>}
     */
    // eslint-disable-next-line no-unused-vars
    async rewriteArgsAsync({base_version, parsedArgs, resourceType, method}) {
        return parsedArgs;
    }
}

module.exports = {
    QueryRewriter
};
