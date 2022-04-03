const {logRequest, logError} = require('../operations/common/logging');

class MyApolloServerLoggingPlugin {
    /***
     * This plugin logs calls to the GraphQL
     * https://www.apollographql.com/docs/apollo-server/integrations/plugins/
     * @param endpoint
     */
    constructor(endpoint) {
        this.endpoint = endpoint;
    }

    // noinspection JSUnusedLocalSymbols
    // eslint-disable-next-line no-unused-vars
    // Fires whenever a GraphQL request is received from a client.
    async requestDidStart(requestContext) {
        const req = requestContext.request;
        const user = (req.authInfo && req.authInfo.context && req.authInfo.context.username)
            || (req.authInfo && req.authInfo.context && req.authInfo.context.subject)
            || req.user;
        logRequest(user, `GraphQL Request ${this.endpoint} Op:${req.operationName}, query:${req.query}`);

        return {
            // https://www.apollographql.com/docs/apollo-server/integrations/plugins-event-reference/#didencountererrors
            async didEncounterErrors(/*requestContext*/) {
                logError(user, `GraphQL Request ${this.endpoint} Op:${req.operationName}, query:${req.query}`);
            },

            // Fires whenever Apollo Server will validate a
            // request's document AST against your GraphQL schema.
            async validationDidStart(/*requestContext*/) {
                console.log('Validation started!');
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


