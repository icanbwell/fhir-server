/**
 * This middleware handles graphql requests
 */
const {ApolloServer} = require('apollo-server-express');
const {join} = require('path');
const resolvers = require('../../graphql/v2/resolvers');
const {loadFilesSync} = require('@graphql-tools/load-files');
const {mergeTypeDefs} = require('@graphql-tools/merge');
const {FhirDataSource} = require('../../graphql/v2/dataSource');

const {
    ApolloServerPluginLandingPageGraphQLPlayground,
    // ApolloServerPluginLandingPageDisabled
} = require('apollo-server-core');
const {getRequestInfo} = require('../../graphql/v2/requestInfoHelper');
const {getBundleMetaApolloServerPlugin} = require('./plugins/graphqlBundleMetaPlugin');
const {getApolloServerLoggingPlugin} = require('./plugins/graphqlLoggingPlugin');
const {createContainer} = require('../../createContainer');


const graphql = async () => {
    const typesArray = loadFilesSync(join(__dirname, '../../graphql/v2/schemas/'), {recursive: true});
    const typeDefs = mergeTypeDefs(typesArray);
    // create the Apollo graphql middleware
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
                getBundleMetaApolloServerPlugin(),
                getApolloServerLoggingPlugin('graphqlv2')
                // ApolloServerPluginLandingPageDisabled()
            ],
            context: async ({req, res}) => {
                const container = createContainer();

                const requestInfo = {
                    user: (req.authInfo && req.authInfo.context && req.authInfo.context.username) ||
                        (req.authInfo && req.authInfo.context && req.authInfo.context.subject) ||
                        ((!req.user || typeof req.user === 'string') ? req.user : req.user.id),
                    patients: req.authInfo && req.authInfo.context && req.authInfo.context.fhirPatientIds,
                    scope: req.authInfo && req.authInfo.scope,
                    remoteIpAddress: req.headers['x-forwarded-for'] || req.connection.remoteAddress,
                    requestId: req.id,
                    protocol: req.protocol,
                    originalUrl: req.originalUrl,
                    path: req.path,
                    host: req.hostname,
                    body: req.body,
                    isUser: req.authInfo && req.authInfo.context && req.authInfo.context.isUser,
                    fhirPersonId: req.authInfo && req.authInfo.context && req.authInfo.context.fhirPersonId,
                    container: container
                };
                return {
                    req,
                    res,
                    ...requestInfo,
                    dataApi: new FhirDataSource(container, getRequestInfo(requestInfo))
                };
            }
        });

    // apollo requires us to start the server first
    await server.start();

    return server.getMiddleware({path: '/'});
};

module.exports.graphql = graphql;
