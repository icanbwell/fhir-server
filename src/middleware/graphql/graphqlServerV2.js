/**
 * This middleware handles graphqlV2 requests
 */
const contentType = require('content-type');
const httpContext = require('express-http-context');
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
const { FhirDataSource } = require('../../graphqlv2/dataSource');
const { FhirRequestInfo } = require('../../utils/fhirRequestInfo');
const { getApolloServerLoggingPlugin } = require('./plugins/graphqlLoggingPlugin');
const { getAddRequestIdToResponseHeadersPlugin } = require('./plugins/graphqlAddRequestIdToResponseHeadersPlugin');
const { getBundleMetaApolloServerPlugin } = require('./plugins/graphqlBundleMetaPlugin');
const { getValidateMissingVariableValuesPlugin } = require('./plugins/graphqlValidateMissingVariableValuesPlugin');
const { removeNullFromArray } = require('../../utils/nullRemover');
const resolvers = require('../../graphqlv2/resolvers');
const { REQUEST_ID_TYPE } = require('../../constants');
const accepts = require("accepts");

/**
 * @param {function (): SimpleContainer} fnGetContainer
 * @return {Promise<e.Router>}
 */
const graphqlV2 = async (fnGetContainer) => {
    const typesArray = loadFilesSync(join(__dirname, '../../graphqlv2/schemas/'), { recursive: true });
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
        configManagerInstance.enableGraphQLV2Playground

            ? ApolloServerPluginLandingPageLocalDefault({
                embed: {
                    runTelemetry: false
                }
            })

            : ApolloServerPluginLandingPageDisabled(),
        getBundleMetaApolloServerPlugin(),
        getApolloServerLoggingPlugin('graphqlv2'),
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
         * @type {import('content-type').ContentType}
         */
        const contentTypeFromHeader = req.headers['content-type'] ? contentType.parse(req.headers['content-type']) : null;
        /**
         * @type {FhirRequestInfo}
         */
        const fhirRequestInfo = new FhirRequestInfo(
            {
                user: (req.authInfo && req.authInfo.context && req.authInfo.context.username) ||
                    (req.authInfo && req.authInfo.context && req.authInfo.context.subject) ||
                    ((!req.user || typeof req.user === 'string') ? req.user : req.user.name || req.user.id),
                scope: req.authInfo && req.authInfo.scope,
                remoteIpAddress: req.socket.remoteAddress,
                requestId: httpContext.get(REQUEST_ID_TYPE.SYSTEM_GENERATED_REQUEST_ID),
                userRequestId: httpContext.get(REQUEST_ID_TYPE.USER_REQUEST_ID),
                protocol: req.protocol,
                originalUrl: req.originalUrl,
                path: req.path,
                host: req.hostname,
                body: req.body,
                isUser: req.authInfo && req.authInfo.context && req.authInfo.context.isUser,
                personIdFromJwtToken: req.authInfo?.context?.personIdFromJwtToken,
                headers: req.headers,
                method: req.method,
                contentTypeFromHeader,
                accept: accepts(req).types()
            });

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
                    configManager: container.configManager,
                    patientDataViewControlManager: container.patientDataViewControlManager,
                    customTracer: container.customTracer,
                    patientScopeManager: container.patientScopeManager
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
            introspection: configManagerInstance.enableGraphQLV2Playground,
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

module.exports.graphqlV2 = graphqlV2;
