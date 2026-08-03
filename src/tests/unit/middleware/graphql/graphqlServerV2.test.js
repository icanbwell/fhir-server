const { describe, test, expect, beforeEach, jest: jestGlobal } = require('@jest/globals');

/**
 * Security Tests for graphqlServerV2.js
 *
 * Tests verify that the GraphQL server middleware:
 * - Does not expose the unrestricted container to resolvers (privilege escalation risk)
 * - Strips stacktraces and exception details from formatError responses
 * - Converts CSRF errors to safe OperationOutcome responses
 * - Does not leak internal file paths or infrastructure details in error messages
 *
 * Tests assert CORRECT (secure) behavior and FAIL on buggy code.
 */

// --- Mocks ---

const mockFhirRequestInfo = {
    personIdFromJwtToken: 'person-123',
    scope: 'patient/*.read',
    requestId: 'test-request-id'
};

jestGlobal.mock('@apollo/server', () => {
    return {
        ApolloServer: jestGlobal.fn().mockImplementation((config) => {
            return {
                start: jestGlobal.fn().mockResolvedValue(undefined),
                _config: config
            };
        })
    };
});

jestGlobal.mock('@apollo/subgraph', () => ({
    buildSubgraphSchema: jestGlobal.fn().mockReturnValue({})
}));

jestGlobal.mock('@as-integrations/express5', () => ({
    expressMiddleware: jestGlobal.fn().mockImplementation((server, options) => {
        return { server, options };
    })
}));

jestGlobal.mock('@apollo/server/plugin/disabled', () => ({
    ApolloServerPluginLandingPageDisabled: jestGlobal.fn().mockReturnValue({ name: 'landing-disabled' }),
    ApolloServerPluginInlineTraceDisabled: jestGlobal.fn().mockReturnValue({ name: 'inline-trace-disabled' })
}));

jestGlobal.mock('@apollo/server/plugin/landingPage/default', () => ({
    ApolloServerPluginLandingPageLocalDefault: jestGlobal.fn().mockReturnValue({ name: 'landing-local' })
}));

jestGlobal.mock('@graphql-tools/load-files', () => ({
    loadFilesSync: jestGlobal.fn().mockReturnValue([])
}));

jestGlobal.mock('@graphql-tools/merge', () => ({
    mergeTypeDefs: jestGlobal.fn().mockReturnValue('merged-type-defs')
}));

jestGlobal.mock('../../../../graphqlv2/dataSource', () => ({
    FhirDataSource: jestGlobal.fn().mockImplementation((args) => ({ ...args, _type: 'FhirDataSource' }))
}));

jestGlobal.mock('../../../../utils/fhirRequestInfoBuilder', () => ({
    FhirRequestInfoBuilder: {
        fromRequest: jestGlobal.fn().mockReturnValue(mockFhirRequestInfo)
    }
}));

jestGlobal.mock('../../../../middleware/graphql/plugins/graphqlLoggingPlugin', () => ({
    getApolloServerLoggingPlugin: jestGlobal.fn().mockReturnValue({ name: 'logging' })
}));

jestGlobal.mock('../../../../middleware/graphql/plugins/graphqlAddRequestIdToResponseHeadersPlugin', () => ({
    getAddRequestIdToResponseHeadersPlugin: jestGlobal.fn().mockReturnValue({ name: 'request-id' })
}));

jestGlobal.mock('../../../../middleware/graphql/plugins/graphqlBundleMetaPlugin', () => ({
    getBundleMetaApolloServerPlugin: jestGlobal.fn().mockReturnValue({ name: 'bundle-meta' })
}));

jestGlobal.mock('../../../../middleware/graphql/plugins/graphqlValidateMissingVariableValuesPlugin', () => ({
    getValidateMissingVariableValuesPlugin: jestGlobal.fn().mockReturnValue({ name: 'validate-vars' })
}));

jestGlobal.mock('../../../../utils/nullRemover', () => ({
    removeNullFromArray: jestGlobal.fn().mockImplementation((val) => val)
}));

jestGlobal.mock('../../../../graphqlv2/resolvers', () => ({}));

jestGlobal.mock('../../../../fhir/classes/4_0_0/resources/operationOutcome', () => {
    return jestGlobal.fn().mockImplementation((args) => ({
        ...args,
        toJSON: jestGlobal.fn().mockReturnValue({
            resourceType: 'OperationOutcome',
            issue: args.issue
        })
    }));
});

jestGlobal.mock('../../../../fhir/classes/4_0_0/backbone_elements/operationOutcomeIssue', () => {
    return jestGlobal.fn().mockImplementation((args) => args);
});

// --- Helpers ---

const { ApolloServer } = require('@apollo/server');

/**
 * Creates a mock container with all services that graphqlServerV2 expects.
 * Includes admin-level operations to test for unrestricted access.
 */
function createMockContainer () {
    return {
        configManager: {
            enableGraphQLV2Playground: false
        },
        searchBundleOperation: { search: jestGlobal.fn() },
        r4ArgsParser: { parse: jestGlobal.fn() },
        queryRewriterManager: { rewrite: jestGlobal.fn() },
        patientDataViewControlManager: { check: jestGlobal.fn() },
        customTracer: { trace: jestGlobal.fn() },
        patientScopeManager: { getScope: jestGlobal.fn() },
        // Admin-level services that should NOT be accessible via GraphQL context
        databaseBulkInserter: { insertAsync: jestGlobal.fn() },
        adminPersonPatientLinkManager: { link: jestGlobal.fn() },
        databaseExportManager: { export: jestGlobal.fn() },
        indexManager: { createIndexes: jestGlobal.fn() },
        accessLogger: { log: jestGlobal.fn() }
    };
}

/**
 * Invokes graphqlV2 and extracts the Apollo config for testing formatError etc.
 */
async function getApolloConfig (container) {
    const { graphqlV2 } = require('../../../../middleware/graphql/graphqlServerV2');
    await graphqlV2(() => container);
    const apolloServerCall = ApolloServer.mock.calls[ApolloServer.mock.calls.length - 1];
    return apolloServerCall[0];
}

/**
 * Invokes graphqlV2 and extracts the context function for testing getContext.
 */
async function getContextFunction (container) {
    const { expressMiddleware } = require('@as-integrations/express5');
    const { graphqlV2 } = require('../../../../middleware/graphql/graphqlServerV2');
    await graphqlV2(() => container);
    const lastCall = expressMiddleware.mock.calls[expressMiddleware.mock.calls.length - 1];
    return lastCall[1].context;
}

describe('graphqlServerV2 - Security Tests', () => {
    let mockContainer;

    beforeEach(() => {
        jestGlobal.clearAllMocks();
        mockContainer = createMockContainer();
    });

    describe('getContext - Container exposure (CRITICAL)', () => {
        test('getContext exposes the ENTIRE container object in GraphQL context — resolvers can access any service', async () => {
            const contextFn = await getContextFunction(mockContainer);
            const mockReq = { headers: {}, method: 'POST', url: '/graphqlv2' };
            const mockRes = {};

            const context = await contextFn({ req: mockReq, res: mockRes });

            // CRITICAL: The container is passed without restriction.
            // Any resolver can call context.container.databaseBulkInserter, context.container.indexManager, etc.
            expect(context.container).toBe(mockContainer);
            expect(context.container.databaseBulkInserter).toBeDefined();
            expect(context.container.adminPersonPatientLinkManager).toBeDefined();
            expect(context.container.databaseExportManager).toBeDefined();
            expect(context.container.indexManager).toBeDefined();
        });

        test('getContext sets req.container to the same unrestricted container', async () => {
            const contextFn = await getContextFunction(mockContainer);
            const mockReq = { headers: {}, method: 'POST', url: '/graphqlv2' };
            const mockRes = {};

            const context = await contextFn({ req: mockReq, res: mockRes });

            // The request object also gets the full container attached
            expect(context.req.container).toBe(mockContainer);
        });

        test('getContext includes fhirRequestInfo derived from the request', async () => {
            const contextFn = await getContextFunction(mockContainer);
            const mockReq = { headers: { authorization: 'Bearer token' }, method: 'POST', url: '/graphqlv2' };
            const mockRes = {};

            const context = await contextFn({ req: mockReq, res: mockRes });

            expect(context.fhirRequestInfo).toBe(mockFhirRequestInfo);
        });

        test('getContext creates FhirDataSource with only the necessary services', async () => {
            const { FhirDataSource } = require('../../../../graphqlv2/dataSource');
            const contextFn = await getContextFunction(mockContainer);
            const mockReq = { headers: {}, method: 'POST', url: '/graphqlv2' };
            const mockRes = {};

            await contextFn({ req: mockReq, res: mockRes });

            expect(FhirDataSource).toHaveBeenCalledWith(
                expect.objectContaining({
                    requestInfo: mockFhirRequestInfo,
                    searchBundleOperation: mockContainer.searchBundleOperation,
                    r4ArgsParser: mockContainer.r4ArgsParser,
                    queryRewriterManager: mockContainer.queryRewriterManager,
                    configManager: mockContainer.configManager,
                    patientDataViewControlManager: mockContainer.patientDataViewControlManager,
                    customTracer: mockContainer.customTracer,
                    patientScopeManager: mockContainer.patientScopeManager
                })
            );
        });
    });

    describe('formatError - Stacktrace stripping', () => {
        test('formatError removes stacktrace from extensions', async () => {
            const config = await getApolloConfig(mockContainer);
            const formattedError = {
                message: 'Something went wrong',
                extensions: {
                    code: 'INTERNAL_SERVER_ERROR',
                    stacktrace: [
                        'Error: Something went wrong',
                        '    at Object.<anonymous> (/app/src/operations/security/scopesManager.js:128:15)',
                        '    at Module._compile (internal/modules/cjs/loader.js:1085:14)'
                    ]
                }
            };

            const result = config.formatError(formattedError, new Error('Something went wrong'));

            expect(result.extensions.stacktrace).toBeUndefined();
        });

        test('formatError removes exception from extensions', async () => {
            const config = await getApolloConfig(mockContainer);
            const formattedError = {
                message: 'Query failed',
                extensions: {
                    code: 'INTERNAL_SERVER_ERROR',
                    exception: {
                        stacktrace: ['Error: Query failed', '    at /app/src/dataLayer/mongo.js:55:11'],
                        message: 'Query failed'
                    }
                }
            };

            const result = config.formatError(formattedError, new Error('Query failed'));

            expect(result.extensions.exception).toBeUndefined();
        });

        test('formatError preserves extensions.code even after stripping stacktrace', async () => {
            const config = await getApolloConfig(mockContainer);
            const formattedError = {
                message: 'Not authorized',
                extensions: {
                    code: 'FORBIDDEN',
                    stacktrace: ['Error at line 1']
                }
            };

            const result = config.formatError(formattedError, new Error('Not authorized'));

            // BUG: extensions.code passes through — this could reveal internal categorization
            expect(result.extensions.code).toBe('FORBIDDEN');
            expect(result.extensions.stacktrace).toBeUndefined();
        });

        test('formatError handles errors with no extensions gracefully', async () => {
            const config = await getApolloConfig(mockContainer);
            const formattedError = {
                message: 'Validation error'
            };

            // Should not throw
            const result = config.formatError(formattedError, new Error('Validation error'));

            expect(result.message).toBe('Validation error');
        });

        test('formatError handles errors with null extensions gracefully', async () => {
            const config = await getApolloConfig(mockContainer);
            const formattedError = {
                message: 'Null extensions',
                extensions: null
            };

            // extensions is null — the if(formattedError.extensions) check prevents crash
            const result = config.formatError(formattedError, new Error('Null extensions'));

            expect(result.message).toBe('Null extensions');
        });
    });

    describe('formatError - CSRF error handling', () => {
        test('CSRF error returns OperationOutcome with severity error and code not-found', async () => {
            const config = await getApolloConfig(mockContainer);
            const csrfMessage = 'This operation has been blocked as a potential Cross-Site Request Forgery (CSRF). Please either specify a \'content-type\' header (with a type that is not one of application/x-www-form-urlencoded, multipart/form-data, text/plain) or provide a non-empty value for one of the following headers: x-apollo-operation-name, apollo-require-preflight';
            const formattedError = {
                message: csrfMessage,
                extensions: {
                    code: 'BAD_REQUEST',
                    stacktrace: ['Error: CSRF blocked']
                }
            };

            const result = config.formatError(formattedError, new Error(csrfMessage));

            expect(result.resourceType).toBe('OperationOutcome');
            expect(result.issue).toBeDefined();
            expect(result.issue[0].severity).toBe('error');
            expect(result.issue[0].code).toBe('not-found');
            expect(result.issue[0].details.text).toBe('Page not found');
        });

        test('CSRF detection uses startsWith — partial prefix match triggers OperationOutcome', async () => {
            const config = await getApolloConfig(mockContainer);
            // The exact prefix that triggers CSRF handling
            const formattedError = {
                message: 'This operation has been blocked as a potential Cross-Site Request Forgery (CSRF) - additional details here',
                extensions: { code: 'BAD_REQUEST' }
            };

            const result = config.formatError(formattedError, new Error());

            expect(result.resourceType).toBe('OperationOutcome');
        });

        test('BUG: CSRF detection fails if Apollo changes error message prefix', async () => {
            const config = await getApolloConfig(mockContainer);
            // If Apollo changes the CSRF message to not start with the expected prefix,
            // the error passes through with full details instead of being masked
            const formattedError = {
                message: 'CSRF attack detected: This operation has been blocked as a potential Cross-Site Request Forgery (CSRF)',
                extensions: {
                    code: 'BAD_REQUEST',
                    stacktrace: ['Error: CSRF at /app/node_modules/@apollo/server/src/middleware.js:44']
                }
            };

            const result = config.formatError(formattedError, new Error());

            // BUG: This does NOT return OperationOutcome because the prefix changed.
            // The error passes through with stacktrace stripped but message intact.
            expect(result.resourceType).not.toBe('OperationOutcome');
            // The raw message leaks through
            expect(result.message).toContain('CSRF');
        });

        test('non-CSRF errors do NOT return OperationOutcome', async () => {
            const config = await getApolloConfig(mockContainer);
            const formattedError = {
                message: 'Variable "$id" of required type "String!" was not provided.',
                extensions: { code: 'BAD_USER_INPUT' }
            };

            const result = config.formatError(formattedError, new Error());

            expect(result.resourceType).toBeUndefined();
            expect(result.message).toBe('Variable "$id" of required type "String!" was not provided.');
        });
    });

    describe('formatError - Internal error message leakage (CRITICAL)', () => {
        test('CRITICAL: internal error messages with file paths leak through formatError', async () => {
            const config = await getApolloConfig(mockContainer);
            const internalMessage = 'Cannot read property \'meta\' of null at /app/src/operations/security/scopesManager.js:128';
            const formattedError = {
                message: internalMessage,
                extensions: {
                    code: 'INTERNAL_SERVER_ERROR',
                    stacktrace: ['Error at line 1']
                }
            };

            const result = config.formatError(formattedError, new Error(internalMessage));

            // BUG: The message is NOT sanitized — file paths and internal state leak
            // formatError only strips extensions.stacktrace and extensions.exception
            expect(result.message).toBe(internalMessage);
            expect(result.message).toContain('/app/src/operations');
            expect(result.message).toContain('scopesManager.js:128');
        });

        test('CRITICAL: database errors with query details leak through formatError', async () => {
            const config = await getApolloConfig(mockContainer);
            const dbMessage = 'MongoServerError: query timed out on collection Patient_4_0_0 filter={"_sourceAssigningAuthority":"tenant-abc"}';
            const formattedError = {
                message: dbMessage,
                extensions: {
                    code: 'INTERNAL_SERVER_ERROR',
                    stacktrace: ['Error at line 1']
                }
            };

            const result = config.formatError(formattedError, new Error(dbMessage));

            // BUG: Collection names and query filters leak through to the client
            expect(result.message).toContain('Patient_4_0_0');
            expect(result.message).toContain('tenant-abc');
            expect(result.message).toContain('_sourceAssigningAuthority');
        });

        test('CRITICAL: connection string errors leak infrastructure details', async () => {
            const config = await getApolloConfig(mockContainer);
            const connMessage = 'MongoServerSelectionError: connection to mongodb+srv://admin:p4ssw0rd@cluster0.mongodb.net/fhir_prod timed out';
            const formattedError = {
                message: connMessage,
                extensions: {
                    code: 'INTERNAL_SERVER_ERROR'
                }
            };

            const result = config.formatError(formattedError, new Error(connMessage));

            // BUG: Connection strings with credentials leak through
            expect(result.message).toContain('mongodb+srv://');
            expect(result.message).toContain('admin:p4ssw0rd');
            expect(result.message).toContain('cluster0.mongodb.net');
        });
    });

    describe('formatError - Extensions pass-through behavior', () => {
        test('BUG: extensions with code INTERNAL_SERVER_ERROR pass through and reveal error classification', async () => {
            const config = await getApolloConfig(mockContainer);
            const formattedError = {
                message: 'An error occurred',
                extensions: {
                    code: 'INTERNAL_SERVER_ERROR',
                    stacktrace: ['line1'],
                    exception: { name: 'MongoError' }
                }
            };

            const result = config.formatError(formattedError, new Error());

            // stacktrace and exception are stripped...
            expect(result.extensions.stacktrace).toBeUndefined();
            expect(result.extensions.exception).toBeUndefined();
            // ...but code stays, revealing that this was an internal server error vs other types
            expect(result.extensions.code).toBe('INTERNAL_SERVER_ERROR');
        });

        test('extensions with custom properties pass through unfiltered', async () => {
            const config = await getApolloConfig(mockContainer);
            const formattedError = {
                message: 'Error',
                extensions: {
                    code: 'BAD_USER_INPUT',
                    stacktrace: ['line1'],
                    // Custom properties that might leak internal info
                    serviceName: 'fhir-server-prod-east-1',
                    operationName: 'searchBundle',
                    collectionName: 'Patient_4_0_0'
                }
            };

            const result = config.formatError(formattedError, new Error());

            // Only stacktrace and exception are deleted — everything else passes
            expect(result.extensions.serviceName).toBe('fhir-server-prod-east-1');
            expect(result.extensions.operationName).toBe('searchBundle');
            expect(result.extensions.collectionName).toBe('Patient_4_0_0');
        });
    });

    describe('Server configuration', () => {
        test('introspection is disabled when playground is disabled', async () => {
            mockContainer.configManager.enableGraphQLV2Playground = false;
            const config = await getApolloConfig(mockContainer);

            expect(config.introspection).toBe(false);
        });

        test('introspection is enabled when playground is enabled', async () => {
            mockContainer.configManager.enableGraphQLV2Playground = true;
            const config = await getApolloConfig(mockContainer);

            expect(config.introspection).toBe(true);
        });

        test('stopOnTerminationSignals is false to allow graceful shutdown', async () => {
            const config = await getApolloConfig(mockContainer);

            expect(config.stopOnTerminationSignals).toBe(false);
        });

        test('cache is set to bounded to prevent unbounded memory growth', async () => {
            const config = await getApolloConfig(mockContainer);

            expect(config.cache).toBe('bounded');
        });
    });

    describe('stringifyResult', () => {
        test('stringifyResult removes null values from arrays via removeNullFromArray', async () => {
            const { removeNullFromArray } = require('../../../../utils/nullRemover');
            const config = await getApolloConfig(mockContainer);
            const testValue = { data: { patient: [null, { id: '1' }] } };

            config.stringifyResult(testValue);

            expect(removeNullFromArray).toHaveBeenCalledWith(testValue);
        });

        test('stringifyResult returns pretty-printed JSON', async () => {
            const config = await getApolloConfig(mockContainer);
            const testValue = { data: { id: '1' } };

            const result = config.stringifyResult(testValue);

            expect(result).toBe(JSON.stringify(testValue, null, 2));
        });
    });
});
