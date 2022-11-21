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
const {getBundleMetaApolloServerPlugin} = require('./plugins/graphqlBundleMetaPlugin');
const {getApolloServerLoggingPlugin} = require('./plugins/graphqlLoggingPlugin');
const {getGraphqlContainerPlugin} = require('./plugins/graphqlContainerPlugin');
const {FhirRequestInfo} = require('../../utils/fhirRequestInfo');


/**
 * @param {function (): SimpleContainer} fnCreateContainer
 * @return {Promise<e.Router>}
 */
const graphql = async (fnCreateContainer) => {
    const typesArray = loadFilesSync(join(__dirname, '../../graphql/v2/schemas/'), {recursive: true});
    const typeDefs = mergeTypeDefs(typesArray);

    /**
     * @type {import('apollo-server-plugin-base').PluginDefinition[]}
     */
    const plugins = [
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
        getApolloServerLoggingPlugin('graphqlv2'),
        getGraphqlContainerPlugin()
        // ApolloServerPluginLandingPageDisabled()
    ];

    /**
     * gets context
     * @param {import('http').IncomingMessage} req
     * @param {import('http').ServerResponse} res
     * @return {Promise<GraphQLContext>}
     */
    async function getContext({req, res}) {
        const container = fnCreateContainer();

        /**
         * @type {FhirRequestInfo}
         */
        const fhirRequestInfo = new FhirRequestInfo(
            {
                user: (req.authInfo && req.authInfo.context && req.authInfo.context.username) ||
                    (req.authInfo && req.authInfo.context && req.authInfo.context.subject) ||
                    ((!req.user || typeof req.user === 'string') ? req.user : req.user.id),
                patientIdsFromJwtToken: req.authInfo && req.authInfo.context && req.authInfo.context.patientIdsFromJwtToken,
                scope: req.authInfo && req.authInfo.scope,
                remoteIpAddress: req.headers['x-forwarded-for'] || req.connection.remoteAddress,
                requestId: req.id,
                protocol: req.protocol,
                originalUrl: req.originalUrl,
                path: req.path,
                host: req.hostname,
                body: req.body,
                isUser: req.authInfo && req.authInfo.context && req.authInfo.context.isUser,
                personIdFromJwtToken: req.authInfo && req.authInfo.context && req.authInfo.context.personIdFromJwtToken,
                headers: req.headers
            });
        return {
            req,
            res,
            fhirRequestInfo,
            dataApi: new FhirDataSource(container, fhirRequestInfo)
        };

    }

    // create the Apollo graphql middleware
    const server = new ApolloServer(
        {
            // schema: schemaWithResolvers,
            typeDefs: typeDefs,
            resolvers: resolvers,
            introspection: true,
            cache: 'bounded',
            plugins: plugins,
            context: async ({req, res}) => await getContext({req, res})
        });

    // apollo requires us to start the server first
    await server.start();

    return server.getMiddleware({path: '/'});
};

module.exports.graphql = graphql;
