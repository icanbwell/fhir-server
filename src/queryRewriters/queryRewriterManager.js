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
     * @return {Promise<{query:import('mongodb').Document,columns:Set}>}
     */
    async rewriteQueryAsync({base_version, query, columns}) {
        for (const queryRewriter of this.queryRewriters) {
            ({query, columns} = await queryRewriter.rewriteQueryAsync({base_version, query, columns}));
        }
        return {query, columns};
    }

    /**
     * rewrites the args
     * @param {Object} args
     * @return {Promise<Object>}
     */
    // eslint-disable-next-line no-unused-vars
    async rewriteArgsAsync({args}) {
        for (const queryRewriter of this.queryRewriters) {
            args = await queryRewriter.rewriteArgsAsync({args});
        }
        return args;
    }
}

module.exports = {
    QueryRewriterManager
};
