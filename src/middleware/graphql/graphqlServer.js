/**
 * This middleware handles graphql requests
 */
const { ApolloServer } = require('@apollo/server');
const { buildSubgraphSchema } = require('@apollo/subgraph');
const { expressMiddleware } = require('@as-integrations/express5');
const {
    ApolloServerPluginLandingPageDisabled,
    ApolloServerPluginInlineTraceDisabled
} = require('@apollo/server/plugin/disabled');
const {
    ApolloServerPluginLandingPageLocalDefault
    // ApolloServerPluginLandingPageProductionDefault
} = require('@apollo/server/plugin/landingPage/default');
const { loadFilesSync } = require('@graphql-tools/load-files');
const { mergeTypeDefs } = require('@graphql-tools/merge');
const { join } = require('path');

const OperationOutcome = require('../../fhir/classes/4_0_0/resources/operationOutcome');
const OperationOutcomeIssue = require('../../fhir/classes/4_0_0/backbone_elements/operationOutcomeIssue');
const { FhirDataSource } = require('../../graphql/dataSource');
const { FhirRequestInfoBuilder } = require('../../utils/fhirRequestInfoBuilder');
const { getApolloServerLoggingPlugin } = require('./plugins/graphqlLoggingPlugin');
const { getAddRequestIdToResponseHeadersPlugin } = require('./plugins/graphqlAddRequestIdToResponseHeadersPlugin');
const { getBundleMetaApolloServerPlugin } = require('./plugins/graphqlBundleMetaPlugin');
const { getValidateMissingVariableValuesPlugin } = require('./plugins/graphqlValidateMissingVariableValuesPlugin');
const { removeNullFromArray } = require('../../utils/nullRemover');
const resolvers = require('../../graphql/resolvers');

/**
 * @param {function (): SimpleContainer} fnGetContainer
 * @return {Promise<e.Router>}
 */
const graphql = async (fnGetContainer) => {
    const typesArray = loadFilesSync(join(__dirname, '../../graphql/schemas/'), { recursive: true });
    const typeDefs = mergeTypeDefs(typesArray);

    /**
     * @type {import('../../utils/simpleContainer')}
     */
    const container = fnGetContainer();
    /**
     * @type {import('../../utils/configManager')}
     */
    const configManagerInstance = container.configManager;

    /**
     * @type {import('apollo-server-plugin-base').PluginDefinition[]}
     */
    const plugins = [
        // request.credentials is set so we receive cookies
        // https://github.com/graphql/graphql-playground#settings
        configManagerInstance.enableGraphQLPlayground

            ? ApolloServerPluginLandingPageLocalDefault({
                embed: {
                    runTelemetry: false
                }
            })

            : ApolloServerPluginLandingPageDisabled(),
        getBundleMetaApolloServerPlugin(),
        getApolloServerLoggingPlugin('graphql'),
        getAddRequestIdToResponseHeadersPlugin(),
        getValidateMissingVariableValuesPlugin(),

        ApolloServerPluginInlineTraceDisabled()
    ];

    /**
     * gets context
     * @param {import('http').IncomingMessage} req
     * @param {import('http').ServerResponse} res
     * @return {Promise<GraphQLContext>}
     */
    async function getContext ({ req, res }) {
        /**
         * @type {FhirRequestInfo}
         */
        const fhirRequestInfo = FhirRequestInfoBuilder.fromRequest(req);

        req.container = container;
        return {
            req,
            res,
            fhirRequestInfo,
            dataApi: new FhirDataSource(
                {
                    requestInfo: fhirRequestInfo,
                    searchBundleOperation: container.searchBundleOperation,
                    r4ArgsParser: container.r4ArgsParser,
                    queryRewriterManager: container.queryRewriterManager,
                    configManager: container.configManager
                }
            ),
            container
        };
    }

    // create the Apollo graphql middleware
    const server = new ApolloServer(
        {
            // schema: schemaWithResolvers,
            schema: buildSubgraphSchema({ typeDefs, resolvers }),
            // typeDefs: typeDefs,
            // resolvers: resolvers,
            introspection: configManagerInstance.enableGraphQLPlayground,
            cache: 'bounded',
            plugins,
            formatError: (formattedError, _error) => {
                // Formatting the error message returned from GraphQL when GraphQL Playground(Currently case of production environment) is disabled.
                if (formattedError.message.startsWith('This operation has been blocked as a potential Cross-Site Request Forgery (CSRF)')) {
                    return new OperationOutcome({
                        issue: [
                            new OperationOutcomeIssue({
                                severity: 'error',
                                code: 'not-found',
                                details: { text: 'Page not found' }
                            })
                        ]
                    }).toJSON();
                }

                // Otherwise return the formatted error.
                return formattedError;
            },
            stringifyResult: (value) => {
                return JSON.stringify(removeNullFromArray(value), null, 2);
            },
            // to process requests during server graceful shutdown
            // https://www.apollographql.com/docs/apollo-server/api/apollo-server#stoponterminationsignals
            stopOnTerminationSignals: false
        });

    // apollo requires us to start the server first
    await server.start();

    return expressMiddleware(server, {
        context: async ({ req, res }) => await getContext({ req, res })
    });
};

module.exports.graphql = graphql;
