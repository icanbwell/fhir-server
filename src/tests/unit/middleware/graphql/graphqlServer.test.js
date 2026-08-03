'use strict';

const { describe, test, expect, beforeEach, jest: jestObj } = require('@jest/globals');

const mockFhirRequestInfo = {
    personIdFromJwtToken: 'person-123',
    scope: 'patient/*.read',
    requestId: 'test-request-id'
};

jestObj.mock('@apollo/server', () => {
    return {
        ApolloServer: jestObj.fn().mockImplementation((config) => {
            return {
                start: jestObj.fn().mockResolvedValue(undefined),
                _config: config
            };
        })
    };
});

jestObj.mock('@apollo/subgraph', () => ({
    buildSubgraphSchema: jestObj.fn().mockReturnValue({})
}));

jestObj.mock('@as-integrations/express5', () => ({
    expressMiddleware: jestObj.fn().mockImplementation((server, options) => {
        return { server, options };
    })
}));

jestObj.mock('@apollo/server/plugin/disabled', () => ({
    ApolloServerPluginLandingPageDisabled: jestObj.fn().mockReturnValue({ name: 'landing-disabled' }),
    ApolloServerPluginInlineTraceDisabled: jestObj.fn().mockReturnValue({ name: 'inline-trace-disabled' })
}));

jestObj.mock('@apollo/server/plugin/landingPage/default', () => ({
    ApolloServerPluginLandingPageLocalDefault: jestObj.fn().mockReturnValue({ name: 'landing-local' })
}));

jestObj.mock('@graphql-tools/load-files', () => ({
    loadFilesSync: jestObj.fn().mockReturnValue([])
}));

jestObj.mock('@graphql-tools/merge', () => ({
    mergeTypeDefs: jestObj.fn().mockReturnValue('merged-type-defs')
}));

jestObj.mock('../../../../graphql/dataSource', () => ({
    FhirDataSource: jestObj.fn().mockImplementation((args) => ({ ...args, _type: 'FhirDataSource' }))
}));

jestObj.mock('../../../../utils/fhirRequestInfoBuilder', () => ({
    FhirRequestInfoBuilder: {
        fromRequest: jestObj.fn().mockReturnValue(mockFhirRequestInfo)
    }
}));

jestObj.mock('../../../../middleware/graphql/plugins/graphqlLoggingPlugin', () => ({
    getApolloServerLoggingPlugin: jestObj.fn().mockReturnValue({ name: 'logging' })
}));

jestObj.mock('../../../../middleware/graphql/plugins/graphqlAddRequestIdToResponseHeadersPlugin', () => ({
    getAddRequestIdToResponseHeadersPlugin: jestObj.fn().mockReturnValue({ name: 'request-id' })
}));

jestObj.mock('../../../../middleware/graphql/plugins/graphqlBundleMetaPlugin', () => ({
    getBundleMetaApolloServerPlugin: jestObj.fn().mockReturnValue({ name: 'bundle-meta' })
}));

jestObj.mock('../../../../middleware/graphql/plugins/graphqlValidateMissingVariableValuesPlugin', () => ({
    getValidateMissingVariableValuesPlugin: jestObj.fn().mockReturnValue({ name: 'validate-vars' })
}));

jestObj.mock('../../../../utils/nullRemover', () => ({
    removeNullFromArray: jestObj.fn().mockImplementation(v => v)
}));

jestObj.mock('../../../../graphql/resolvers', () => ({}));

jestObj.mock('../../../../fhir/classes/4_0_0/resources/operationOutcome', () => {
    return jestObj.fn().mockImplementation((props) => ({ ...props, toJSON: () => props }));
});

jestObj.mock('../../../../fhir/classes/4_0_0/backbone_elements/operationOutcomeIssue', () => {
    return jestObj.fn().mockImplementation((props) => props);
});

const { ApolloServer } = require('@apollo/server');
const { expressMiddleware } = require('@as-integrations/express5');
const { ApolloServerPluginLandingPageDisabled } = require('@apollo/server/plugin/disabled');
const { ApolloServerPluginLandingPageLocalDefault } = require('@apollo/server/plugin/landingPage/default');
const { graphql } = require('../../../../middleware/graphql/graphqlServer');

describe('graphqlServer', () => {
    let mockContainer;
    let fnGetContainer;

    beforeEach(() => {
        jestObj.clearAllMocks();

        mockContainer = {
            configManager: {
                enableGraphQLPlayground: true
            },
            searchBundleOperation: {},
            r4ArgsParser: {},
            queryRewriterManager: {},
            accessManager: {}
        };

        fnGetContainer = () => mockContainer;
    });

    describe('graphql function', () => {
        test('creates and starts Apollo server', async () => {
            await graphql(fnGetContainer);

            expect(ApolloServer).toHaveBeenCalledTimes(1);
            const serverInstance = ApolloServer.mock.results[0].value;
            expect(serverInstance.start).toHaveBeenCalledTimes(1);
        });

        test('returns expressMiddleware result', async () => {
            const result = await graphql(fnGetContainer);

            expect(expressMiddleware).toHaveBeenCalledTimes(1);
            expect(result).toBeDefined();
            expect(result.server).toBeDefined();
        });

        test('uses landing page local when playground is enabled', async () => {
            mockContainer.configManager.enableGraphQLPlayground = true;

            await graphql(fnGetContainer);

            expect(ApolloServerPluginLandingPageLocalDefault).toHaveBeenCalled();
            expect(ApolloServerPluginLandingPageDisabled).not.toHaveBeenCalled();
        });

        test('uses landing page disabled when playground is disabled', async () => {
            mockContainer.configManager.enableGraphQLPlayground = false;

            await graphql(fnGetContainer);

            expect(ApolloServerPluginLandingPageDisabled).toHaveBeenCalled();
        });

        test('passes introspection setting matching playground config', async () => {
            mockContainer.configManager.enableGraphQLPlayground = true;

            await graphql(fnGetContainer);

            const serverConfig = ApolloServer.mock.calls[0][0];
            expect(serverConfig.introspection).toBe(true);
        });

        test('sets cache to bounded', async () => {
            await graphql(fnGetContainer);

            const serverConfig = ApolloServer.mock.calls[0][0];
            expect(serverConfig.cache).toBe('bounded');
        });

        test('sets stopOnTerminationSignals to false', async () => {
            await graphql(fnGetContainer);

            const serverConfig = ApolloServer.mock.calls[0][0];
            expect(serverConfig.stopOnTerminationSignals).toBe(false);
        });

        test('formatError strips stacktrace from extensions', async () => {
            await graphql(fnGetContainer);

            const serverConfig = ApolloServer.mock.calls[0][0];
            const formattedError = serverConfig.formatError(
                {
                    message: 'Some error',
                    extensions: {
                        stacktrace: ['line1', 'line2'],
                        exception: { message: 'inner' },
                        code: 'INTERNAL_SERVER_ERROR'
                    }
                },
                new Error('original')
            );

            expect(formattedError.extensions.stacktrace).toBeUndefined();
            expect(formattedError.extensions.exception).toBeUndefined();
            expect(formattedError.extensions.code).toBe('INTERNAL_SERVER_ERROR');
        });

        test('formatError converts CSRF error to OperationOutcome', async () => {
            await graphql(fnGetContainer);

            const serverConfig = ApolloServer.mock.calls[0][0];
            const formattedError = serverConfig.formatError(
                {
                    message: 'This operation has been blocked as a potential Cross-Site Request Forgery (CSRF) attack.',
                    extensions: {}
                },
                new Error('csrf')
            );

            expect(formattedError.issue).toBeDefined();
            expect(formattedError.issue[0].severity).toBe('error');
            expect(formattedError.issue[0].code).toBe('not-found');
        });

        test('stringifyResult produces formatted JSON', async () => {
            await graphql(fnGetContainer);

            const serverConfig = ApolloServer.mock.calls[0][0];
            const result = serverConfig.stringifyResult({ data: { patient: { id: '1' } } });

            expect(result).toBe(JSON.stringify({ data: { patient: { id: '1' } } }, null, 2));
        });
    });
});
