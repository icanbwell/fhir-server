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
     * @param {'READ'|'WRITE'} operation
     * @return {Promise<{query:import('mongodb').Document,columns:Set}>}
     */

    async rewriteQueryAsync ({ base_version, query, columns, resourceType, operation }) {
        return { query, columns };
    }

    /**
     * rewrites the args
     * @param {string} base_version
     * @param {ParsedArgs} parsedArgs
     * @param {string} resourceType
     * @param {'READ'|'WRITE'} operation
     * @return {Promise<ParsedArgs>}
     */

    async rewriteArgsAsync ({ base_version, parsedArgs, resourceType, operation }) {
        return parsedArgs;
    }
}

module.exports = {
    QueryRewriter
};
