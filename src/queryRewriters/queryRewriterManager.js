const {RethrownError} = require('../utils/rethrownError');

/**
 * @typedef methodSpecificQueryRewritersType
 * @property {import('./rewriters/queryRewriter').QueryRewriter[]} GET
 * @property {import('./rewriters/queryRewriter').QueryRewriter[]} POST
 * @property {import('./rewriters/queryRewriter').QueryRewriter[]} DELETE
 * @property {import('./rewriters/queryRewriter').QueryRewriter[]} PUT
 * @property {import('./rewriters/queryRewriter').QueryRewriter[]} PATCH
 */

class QueryRewriterManager {
    /**
     * constructor
     * @typedef params
     * @property {import('./rewriters/queryRewriter').QueryRewriter[]} queryRewriters
     * @property {methodSpecificQueryRewritersType} methodSpecificQueryRewriters
     *
     * @param {params}
     */
    constructor({queryRewriters, methodSpecificQueryRewriters}) {
        /**
         * @type {import('./rewriters/queryRewriter').QueryRewriter[]}
         */
        this.queryRewriters = queryRewriters;
        /**
         * @type {methodSpecificQueryRewritersType}
         */
        this.methodSpecificQueryRewriters = methodSpecificQueryRewriters;
    }

    /**
     * rewrites the query
     * @typedef rewriteQueryAsyncParams
     * @property {string} base_version
     * @property {import('mongodb').Document} query
     * @property {Set} columns
     * @property {string} resourceType
     * @property {'GET'|'POST'|'PUT'|'PATCH'|'DELETE'} method
     *
     * @param {rewriteQueryAsyncParams}
     * @return {Promise<{query:import('mongodb').Document,columns:Set}>}
     */
    async rewriteQueryAsync({base_version, query, columns, resourceType, method}) {
        /**
         * @typedef {import('./rewriters/queryRewriter').QueryRewriter[]}
         */
        const queryRewriters = [
            ...this.queryRewriters,
            ...(this.methodSpecificQueryRewriters[`${method}`] || [])
        ];
        for (const queryRewriter of queryRewriters) {
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
     * @typedef rewriteArgsAsyncParams
     * @property {string} base_version
     * @property {ParsedArgs} parsedArgs
     * @property {string} resourceType
     * @property {'GET'|'POST'|'PUT'|'PATCH'|'DELETE'} method
     *
     * @param {rewriteArgsAsyncParams}
     * @return {Promise<ParsedArgs>}
     */
    // eslint-disable-next-line no-unused-vars
    async rewriteArgsAsync({base_version, parsedArgs, resourceType, method}) {
        /**
         * @typedef {import('./rewriters/queryRewriter').QueryRewriter[]}
         */
        const queryRewriters = [
            ...this.queryRewriters,
            ...(this.methodSpecificQueryRewriters[`${method}`] || [])
        ];
        for (const queryRewriter of queryRewriters) {
            parsedArgs = await queryRewriter.rewriteArgsAsync({base_version, parsedArgs, resourceType});
        }
        return parsedArgs;
    }
}

module.exports = {
    QueryRewriterManager
};
