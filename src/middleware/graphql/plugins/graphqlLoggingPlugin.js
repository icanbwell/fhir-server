const async = require('async');
const {logRequest, logError} = require('../../../operations/common/logging');

// const {ApolloServerPlugin} = require('apollo-server-plugin-base');

/***
 * Plugin to log calls to GraphQL
 */
class MyApolloServerLoggingPlugin /*extends ApolloServerPlugin*/ {
    /***
     * This plugin logs calls to the GraphQL
     * https://www.apollographql.com/docs/apollo-server/integrations/plugins/
     * @param {string} endpoint
     */
    constructor(endpoint) {
        /**
         * @type {string}
         */
        this.endpoint = endpoint;
    }

    /**
     * The requestDidStart event fires whenever Apollo Server receives a GraphQL request, before any of the lifecycle
     * events listed above. You can respond to this event just like you respond to serverWillStart, but you also use
     * this function to define responses for a request's lifecycle events
     * https://www.apollographql.com/docs/apollo-server/integrations/plugins/
     * @param {import('apollo-server-core/dist/requestPipeline').GraphQLRequestContext} requestContext
     * @return {Promise<{executionDidEnd(*): Promise<void>}|{executionDidStart(): Promise<{executionDidEnd(*): Promise<void>}>, parsingDidStart(): Promise<function(*): Promise<void>>, validationDidStart(): Promise<function(*): Promise<void>>}|(function(*): Promise<void>)|*>}
     */
    async requestDidStart(requestContext) {
        const req = requestContext.request;
        const user = requestContext.context ? requestContext.context.user : null;
        const container = requestContext.context ? requestContext.context.container : null;
        const self = this;

        logRequest({
            user,
            args: {
                message: 'GraphQL Request Received',
                endpoint: self.endpoint,
                operationName: req.operationName,
                query: req.query,
            }
        });


        return {
            async parsingDidStart() {
                return async (err) => {
                    if (err) {
                        logError(
                            {
                                user,
                                args:
                                    {
                                        message: 'GraphQL Request Parsing Error',
                                        endpoint: self.endpoint,
                                        operationName: req.operationName,
                                        query: req.query,
                                        error: err
                                    }
                            }
                        );
                    }
                };
            },
            async validationDidStart() {
                // This end hook is unique in that it can receive an array of errors,
                // which will contain every validation error that occurred.
                return async (errs) => {
                    if (errs) {
                        await async.forEach(
                            errs,
                            async (err) => {
                                logError(
                                    {
                                        user,
                                        args: {
                                            message: 'GraphQL Request Validation Error',
                                            endpoint: self.endpoint,
                                            operationName: req.operationName,
                                            query: req.query,
                                            error: err
                                        }
                                    }
                                );
                                if (container) {
                                    /**
                                     * @type {ErrorReporter}
                                     */
                                    const errorReporter = container.errorReporter;
                                    if (errorReporter) {
                                        await errorReporter.reportErrorAsync(
                                            {
                                                source: 'GraphQLv2',
                                                message: `GraphQL Validation Error: ${err.message}`,
                                                error: err,
                                                args: {
                                                    user,
                                                    req,
                                                }
                                            }
                                        );
                                    }
                                }
                            }
                        );
                    }
                };
            },
            async executionDidStart() {
                return {
                    async executionDidEnd(err) {
                        if (err) {
                            logError(
                                {
                                    user,
                                    args:
                                        {
                                            message: 'GraphQL Request Execution Error',
                                            endpoint: self.endpoint,
                                            operationName: req.operationName,
                                            query: req.query,
                                            error: err
                                        }
                                }
                            );
                            if (container) {
                                /**
                                 * @type {ErrorReporter}
                                 */
                                const errorReporter = container.errorReporter;
                                if (errorReporter) {
                                    await errorReporter.reportErrorAsync(
                                        {
                                            source: 'GraphQLv2',
                                            message: `GraphQL Error: ${err.message}`,
                                            error: err,
                                            args: {
                                                user,
                                                req,
                                            }
                                        }
                                    );
                                }
                            }
                        }
                    }
                };
            },
        };
    }
}

const getApolloServerLoggingPlugin = (endpoint) => {
    return new MyApolloServerLoggingPlugin(endpoint);
};

module.exports = {
    getApolloServerLoggingPlugin: getApolloServerLoggingPlugin
};


