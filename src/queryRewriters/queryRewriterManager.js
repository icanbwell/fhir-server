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
    async rewriteAsync({base_version, query, columns}) {
        for (const queryRewriter of this.queryRewriters) {
            ({query, columns} = await queryRewriter.rewriteAsync({base_version, query, columns}));
        }
        return {query, columns};
    }
}

module.exports = {
    QueryRewriterManager
};
