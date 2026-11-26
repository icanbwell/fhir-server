const { trace, SpanStatusCode } = require('@opentelemetry/api');
const { Kind } = require('graphql');
const { logError } = require('../../../operations/common/logging');
const { recordGraphQlError, recordGraphQlPartialResponse } = require('../../../utils/metrics');
const { getGraphQlErrorCode } = require('../graphqlErrorCode');

const UNKNOWN = 'unknown';

/**
 * Returns the schema field name for the first segment of an error path. That segment is the
 * response key, which is the client's alias when the query uses one, so it must never be used
 * as a metric label. Only the field name in the operation's root selection set is used; an
 * operation that has been validated can only select schema fields. Root fields reached through
 * a fragment are not resolved and give unknown.
 * @param {import('graphql').OperationDefinitionNode|undefined} operation
 * @param {import('graphql').GraphQLError} error
 * @return {string}
 */
const getRootFieldName = (operation, error) => {
    if (!error.path || error.path.length === 0) {
        return UNKNOWN;
    }
    const responseKey = String(error.path[0]);
    const selections = operation?.selectionSet?.selections || [];
    const field = selections.find(
        (s) => s.kind === Kind.FIELD && (s.alias ? s.alias.value : s.name.value) === responseKey
    );
    return field ? field.name.value : UNKNOWN;
};

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
                    const rootField = getRootFieldName(requestContext.operation, error);
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
