const { trace, SpanStatusCode } = require('@opentelemetry/api');
const { logError } = require('../../../operations/common/logging');
const { recordGraphQlError, recordGraphQlPartialResponse } = require('../../../utils/metrics');
const { getGraphQlErrorCode } = require('../graphqlErrorCode');

const UNKNOWN = 'unknown';

/**
 * Records GraphQL errors in logs, the active span and metrics.
 *
 * Apollo's `executionDidEnd(err)` only fires when execution itself throws, not when a field
 * resolver throws, so resolver errors were invisible. `didEncounterErrors` fires for every
 * error in the response. Nothing here logs the query text or variables, which can hold PHI.
 */
class MyApolloServerErrorRecordingPlugin /* extends ApolloServerPlugin */ {
    /**
     * @param {string} endpoint
     */
    constructor (endpoint) {
        /**
         * @type {string}
         */
        this.endpoint = endpoint;
    }

    /**
     * @param {import('@apollo/server').GraphQLRequestContext} requestContext
     * @return {Promise<import('@apollo/server').GraphQLRequestListener>}
     */
    async requestDidStart (requestContext) {
        const endpoint = this.endpoint;
        const operationType = () => requestContext.operation?.operation || UNKNOWN;

        return {
            async didEncounterErrors (ctx) {
                const operationName = ctx.request.operationName || UNKNOWN;
                const span = trace.getActiveSpan();
                for (const error of ctx.errors || []) {
                    const code = getGraphQlErrorCode(error);
                    const rootField = error.path && error.path.length > 0 ? String(error.path[0]) : UNKNOWN;
                    logError('GraphQL Resolver Error', {
                        source: 'GraphQL',
                        args: {
                            endpoint,
                            operationName,
                            operationType: operationType(),
                            code,
                            path: error.path ? error.path.map(String).join('.') : undefined
                        }
                    });
                    recordGraphQlError({ endpoint, operationType: operationType(), code, rootField });
                }
                if (span && (ctx.errors || []).length > 0) {
                    span.setStatus({
                        code: SpanStatusCode.ERROR,
                        message: `GraphQL errors: ${ctx.errors.length}`
                    });
                }
            },
            async willSendResponse (ctx) {
                const body = ctx.response && ctx.response.body;
                if (body && body.kind === 'single') {
                    const { data, errors } = body.singleResult;
                    if (data && errors && errors.length > 0) {
                        recordGraphQlPartialResponse({ endpoint, operationType: operationType() });
                    }
                }
            }
        };
    }
}

const getApolloServerErrorRecordingPlugin = (endpoint) => {
    return new MyApolloServerErrorRecordingPlugin(endpoint);
};

module.exports = {
    getApolloServerErrorRecordingPlugin
};
