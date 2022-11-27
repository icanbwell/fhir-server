// const {ApolloServerPlugin} = require('apollo-server-plugin-base');

/***
 * Plugin to log calls to GraphQL
 */
class GraphqlContainerPlugin /*extends ApolloServerPlugin*/ {
    /**
     */
    constructor() {

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
        const container = requestContext.context ? requestContext.context.container : null;
        const requestId = requestContext.context && requestContext.context.req ? requestContext.context.req.id : null;

        return {
            async executionDidStart() {
                return {
                    async executionDidEnd(/*err*/) {
                        if (container) {
                            const postRequestProcessor = container.postRequestProcessor;
                            const requestSpecificCache = container.requestSpecificCache;
                            if (postRequestProcessor) {
                                await postRequestProcessor.executeAsync({requestId});
                                await requestSpecificCache.clearAsync({requestId});
                            }
                        }
                    }
                };
            },
        };
    }

}

const getGraphqlContainerPlugin = () => {
    return new GraphqlContainerPlugin();
};

module.exports = {
    getGraphqlContainerPlugin
};
