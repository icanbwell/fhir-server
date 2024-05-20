const { RethrownError } = require('../utils/rethrownError');

/**
 * @typedef OperationSpecificQueryRewritersType
 * @property {import('./rewriters/queryRewriter').QueryRewriter[]} READ
 * @property {import('./rewriters/queryRewriter').QueryRewriter[]} WRITE
 */

class QueryRewriterManager {
    /**
     * constructor
     * @typedef params
     * @property {import('./rewriters/queryRewriter').QueryRewriter[]} queryRewriters
     * @property {OperationSpecificQueryRewritersType} operationSpecificQueryRewriters
     *
     * @param {params}
     */
    constructor ({ queryRewriters, operationSpecificQueryRewriters }) {
        /**
         * @type {import('./rewriters/queryRewriter').QueryRewriter[]}
         */
        this.queryRewriters = queryRewriters;
        /**
         * @type {OperationSpecificQueryRewritersType}
         */
        this.operationSpecificQueryRewriters = operationSpecificQueryRewriters;
    }

    /**
     * rewrites the query
     * @typedef rewriteQueryAsyncParams
     * @property {string} base_version
     * @property {import('mongodb').Document} query
     * @property {Set} columns
     * @property {string} resourceType
     * @property {'READ'|'WRITE'} operation
     *
     * @param {rewriteQueryAsyncParams}
     * @return {Promise<{query:import('mongodb').Document,columns:Set}>}
     */
    async rewriteQueryAsync ({ base_version, query, columns, resourceType, operation }) {
        /**
         * @typedef {import('./rewriters/queryRewriter').QueryRewriter[]}
         */
        const queryRewriters = [
            ...this.queryRewriters,
            ...(this.operationSpecificQueryRewriters[`${operation}`] || [])
        ];
        for (const queryRewriter of queryRewriters) {
            try {
                ({ query, columns } = await queryRewriter.rewriteQueryAsync({
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
        return { query, columns };
    }

    /**
     * rewrites the args
     * @typedef rewriteArgsAsyncParams
     * @property {string} base_version
     * @property {ParsedArgs} parsedArgs
     * @property {string} resourceType
     * @property {'READ'|'WRITE'} operation
     *
     * @param {rewriteArgsAsyncParams}
     * @return {Promise<ParsedArgs>}
     */

    async rewriteArgsAsync ({ base_version, parsedArgs, resourceType, operation }) {
        /**
         * @typedef {import('./rewriters/queryRewriter').QueryRewriter[]}
         */
        const queryRewriters = [
            ...this.queryRewriters,
            ...(this.operationSpecificQueryRewriters[`${operation}`] || [])
        ];
        for (const queryRewriter of queryRewriters) {
            parsedArgs = await queryRewriter.rewriteArgsAsync({ base_version, parsedArgs, resourceType });
        }
        return parsedArgs;
    }
}

module.exports = {
    QueryRewriterManager
};
