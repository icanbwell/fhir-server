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
            ({query, columns} = await queryRewriter.rewriteQueryAsync({base_version, query, columns, resourceType}));
        }
        return {query, columns};
    }

    /**
     * rewrites the args
     * @param {string} base_version
     * @param {Object} args
     * @param {string} resourceType
     * @return {Promise<Object>}
     */
    // eslint-disable-next-line no-unused-vars
    async rewriteArgsAsync({base_version, args, resourceType}) {
        for (const queryRewriter of this.queryRewriters) {
            args = await queryRewriter.rewriteArgsAsync({base_version, args, resourceType});
        }
        return args;
    }
}

module.exports = {
    QueryRewriterManager
};
