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
     * @property {import('../operations/query/parsedArgs').ParsedArgs} [parsedArgs]
     *
     * @param {rewriteQueryAsyncParams}
     * @return {Promise<{query:import('mongodb').Document,columns:Set,additionalRewriteQueries:import('./rewriters/queryRewriter').AdditionalRewriteQuery[]}>}
     */
    async rewriteQueryAsync ({ base_version, query, columns, resourceType, operation, parsedArgs }) {
        /**
         * @typedef {import('./rewriters/queryRewriter').QueryRewriter[]}
         */
        const queryRewriters = [
            ...this.queryRewriters,
            ...(this.operationSpecificQueryRewriters[`${operation}`] || [])
        ];
        /**
         * queries the rewriters ran on their own, to be listed in the `_debug` / `_explain` metadata
         * @type {import('./rewriters/queryRewriter').AdditionalRewriteQuery[]}
         */
        const additionalRewriteQueries = [];
        for (const queryRewriter of queryRewriters) {
            try {
                const rewritten = await queryRewriter.rewriteQueryAsync({
                    base_version,
                    query,
                    columns,
                    resourceType,
                    parsedArgs
                });
                ({ query, columns } = rewritten);
                additionalRewriteQueries.push(...(rewritten.additionalRewriteQueries || []));
            } catch (e) {
                throw new RethrownError({
                    message: 'Error in rewriteQueryAsync(): ', error: e
                });
            }
        }
        return { query, columns, additionalRewriteQueries };
    }

    /**
     * rewrites the args
     * @typedef rewriteArgsAsyncParams
     * @property {string} base_version
     * @property {ParsedArgs} parsedArgs
     * @property {string} resourceType
     * @property {'READ'|'WRITE'} operation
     * @property {FhirRequestInfo} requestInfo
     * @property {function({resourceType: string, args: Object, requestInfo: FhirRequestInfo}): Promise<string[]>} [searchResourceAsync]
     *   call-time only, not constructor-injected -- avoids a DI cycle with rewriters whose
     *   dependencies (searchManager, fhirOperationsManager) themselves depend on this manager
     *
     * @param {rewriteArgsAsyncParams}
     * @return {Promise<ParsedArgs>}
     */

    async rewriteArgsAsync ({ base_version, parsedArgs, resourceType, operation, requestInfo, searchResourceAsync }) {
        /**
         * @typedef {import('./rewriters/queryRewriter').QueryRewriter[]}
         */
        const queryRewriters = [
            ...this.queryRewriters,
            ...(this.operationSpecificQueryRewriters[`${operation}`] || [])
        ];
        for (const queryRewriter of queryRewriters) {
            parsedArgs = await queryRewriter.rewriteArgsAsync({
                base_version, parsedArgs, resourceType, requestInfo, searchResourceAsync
            });
        }
        return parsedArgs;
    }
}

module.exports = {
    QueryRewriterManager
};
