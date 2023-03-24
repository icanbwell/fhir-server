const {RethrownError} = require('../utils/rethrownError');

class QueryRewriterManager {
    /**
     * constructor
     * @param {QueryRewriter[]} queryRewriters
     */
    constructor({queryRewriters}) {
        /**
         * @type {QueryRewriter[]}
         */
        this.queryRewriters = queryRewriters;
    }

    /**
     * rewrites the query
     * @param {string} base_version
     * @param {import('mongodb').Document} query
     * @param {Set} columns
     * @param {string} resourceType
     * @return {Promise<{query:import('mongodb').Document,columns:Set}>}
     */
    async rewriteQueryAsync({base_version, query, columns, resourceType}) {
        for (const queryRewriter of this.queryRewriters) {
            try {
                ({query, columns} = await queryRewriter.rewriteQueryAsync({
                    base_version,
                    query,
                    columns,
                    resourceType
                }));
            } catch (e) {
                throw new RethrownError({
                    message: 'Error in rewriteQueryAsync(): ', error: e
                });
            }
        }
        return {query, columns};
    }

    /**
     * rewrites the args
     * @param {string} base_version
     * @param {ParsedArgs} parsedArgs
     * @param {string} resourceType
     * @return {Promise<ParsedArgs>}
     */
    // eslint-disable-next-line no-unused-vars
    async rewriteArgsAsync({base_version, parsedArgs, resourceType}) {
        for (const queryRewriter of this.queryRewriters) {
            parsedArgs = await queryRewriter.rewriteArgsAsync({base_version, parsedArgs, resourceType});
        }
        return parsedArgs;
    }
}

module.exports = {
    QueryRewriterManager
};
