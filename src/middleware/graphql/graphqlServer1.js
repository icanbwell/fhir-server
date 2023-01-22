/**
 * This middleware handles graphql requests
 */
const {ApolloServer} = require('apollo-server-express');
const {join} = require('path');
const resolvers = require('../../graphql/v1/resolvers');
const { REQUEST_ID_HEADER } = require('../../constants');
const {loadFilesSync} = require('@graphql-tools/load-files');
const {mergeTypeDefs} = require('@graphql-tools/merge');

const {
    ApolloServerPluginLandingPageGraphQLPlayground,
    // ApolloServerPluginLandingPageDisabled
} = require('apollo-server-core');
const {getApolloServerLoggingPlugin} = require('./plugins/graphqlLoggingPlugin');
const {getGraphqlContainerPlugin} = require('./plugins/graphqlContainerPlugin');
const {generateUUID} = require('../../utils/uid.util');
const {getAddRequestIdToResponseHeadersPlugin} = require('./plugins/graphqlAddRequestIdToResponseHeadersPlugin');

/**
 * @param {function (): SimpleContainer} fnCreateContainer
 * @return {Promise<e.Router>}
 */
const graphql = async (fnCreateContainer) => {
    const typesArray = loadFilesSync(join(__dirname, '../../graphql/v1/schemas/'), {recursive: true});
    const typeDefs = mergeTypeDefs(typesArray);
    // create the Apollo graphql middleware
    // noinspection JSCheckFunctionSignatures
    const server = new ApolloServer(
        {
            // schema: schemaWithResolvers,
            typeDefs: typeDefs,
            resolvers: resolvers,
            introspection: true,
            cache: 'bounded',
            plugins: [
                // request.credentials is set so we receive cookies
                // https://github.com/graphql/graphql-playground#settings
                // eslint-disable-next-line new-cap
                ApolloServerPluginLandingPageGraphQLPlayground(
                    {
                        settings: {
                            'request.credentials': 'same-origin',
                            'schema.polling.enable': false, // enables automatic schema polling
                        },
                        cdnUrl: 'https://cdn.jsdelivr.net/npm',
                        faviconUrl: '',
                    }
                ),
                getApolloServerLoggingPlugin('graphqlv1'),
                getGraphqlContainerPlugin(),
                getAddRequestIdToResponseHeadersPlugin()
                // ApolloServerPluginLandingPageDisabled()
            ],
            context: async ({req, res}) => {
                req.id = req.id || req.header(`${REQUEST_ID_HEADER}`) || generateUUID();
                return {
                    req,
                    res,
                    user: (req.authInfo && req.authInfo.context && req.authInfo.context.username) ||
                        (req.authInfo && req.authInfo.context && req.authInfo.context.subject) ||
                        ((!req.user || typeof req.user === 'string') ? req.user : req.user.name || req.user.id),
                    scope: req.authInfo && req.authInfo.scope,
                    remoteIpAddress: req.headers['x-forwarded-for'] || req.socket.remoteAddress,
                    requestId: req.id,
                    protocol: req.protocol,
                    originalUrl: req.originalUrl,
                    path: req.path,
                    host: req.hostname,
                    body: req.body,
                    headers: req.headers,
                    container: fnCreateContainer()
                };
            }
        });

    // apollo requires us to start the sever first
    await server.start();

    return server.getMiddleware({path: '/'});
};

module.exports.graphqlv1 = graphql;
