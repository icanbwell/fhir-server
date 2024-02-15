const async = require('async');
const {logInfo, logError} = require('../../../operations/common/logging');

/***
 * Plugin to log calls to GraphQL
 */
class MyApolloServerLoggingPlugin /* extends ApolloServerPlugin */ {
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
        /**
         * @type {{req: IncomingMessage, res: ServerResponse, fhirRequestInfo: FhirRequestInfo, dataApi: FhirDataSource, container: SimpleContainer}}
         */
        const context = requestContext.contextValue;

        const req = requestContext.request;
        const user = context ? context.user : null;
        const self = this;

        logInfo(
            'GraphQL Request Received',
            {
                user,
                args: {
                    endpoint: self.endpoint,
                    operationName: req.operationName,
                    query: req.query
                }
            }
        );

        return {
            async parsingDidStart() {
                return async (err) => {
                    if (err) {
                        logError(
                            'GraphQL Request Parsing Error',
                            {
                                user,
                                args:
                                    {
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
                                logError(`GraphQL Request Validation Error: ${err.message}`, {
                                    error: err,
                                    source: 'GraphQL',
                                    args: {
                                        endpoint: self.endpoint,
                                        operationName: req.operationName,
                                        query: req.query,
                                        user
                                    }
                                });
                            }
                        );
                    }
                };
            },
            async executionDidStart() {
                return {
                    async executionDidEnd(err) {
                        if (err) {
                            logError(`GraphQL Request Execution Error: ${err.message}`, {
                                error: err,
                                source: 'GraphQL',
                                args: {
                                    endpoint: self.endpoint,
                                    operationName: req.operationName,
                                    query: req.query,
                                    user
                                }
                            });
                        }
                    }
                };
            }
        };
    }
}

const getApolloServerLoggingPlugin = (endpoint) => {
    return new MyApolloServerLoggingPlugin(endpoint);
};

module.exports = {
    getApolloServerLoggingPlugin: getApolloServerLoggingPlugin
};

