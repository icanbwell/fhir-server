/**
 * @typedef {Object} AdditionalRewriteQuery a query a rewriter ran on its own, to be listed in the `_debug` / `_explain` metadata
 * @property {import('../../operations/graph/queryItem').QueryItem} queryItem
 * @property {Object} options
 * @property {import('mongodb').Document[]} explanations
 * @property {Set} columns
 */

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
     * @param {ParsedArgs} [parsedArgs] read-only: lets a rewriter see `_debug` / `_explain`
     * @return {Promise<{query:import('mongodb').Document,columns:Set,additionalRewriteQueries:AdditionalRewriteQuery[]}>}
     *   `additionalRewriteQueries` are the queries the rewriter ran on its own (empty when none), so
     *   the `_debug` / `_explain` bundle tags list them
     */

    async rewriteQueryAsync ({ base_version, query, columns, resourceType, operation, parsedArgs }) {
        return { query, columns, additionalRewriteQueries: [] };
    }

    /**
     * rewrites the args
     * @param {string} base_version
     * @param {ParsedArgs} parsedArgs
     * @param {string} resourceType
     * @param {'READ'|'WRITE'} operation
     * @param {function({resourceType: string, args: Object, requestInfo: Object}): Promise<string[]>} [searchResourceAsync]
     * @return {Promise<ParsedArgs>}
     */

    async rewriteArgsAsync ({ base_version, parsedArgs, resourceType, operation, searchResourceAsync }) {
        return parsedArgs;
    }
}

module.exports = {
    QueryRewriter
};
